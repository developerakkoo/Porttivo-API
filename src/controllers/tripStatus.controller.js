const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const { checkVehicleHasActiveTrip } = require('../utils/vehicleValidation');
const { getMilestoneTypeByNumber, getDriverLabel } = require('../utils/milestoneMapping');
const {
  emitTripStarted,
  emitTripCompleted,
  emitTripPodPending,
  emitTripClosedWithoutPOD,
  emitTripAutoActivated,
} = require('../services/socket.service');
const { activateNextTrip } = require('../services/tripQueue.service');
const { sendTripCompletedTemplate } = require('../services/wati.service');
const { TRIP_STATUS, calculatePodDueAt } = require('../utils/tripState');

const toAuditUserType = (userType) => {
  switch (userType) {
    case 'company-user':
      return 'COMPANY_USER';
    case 'transporter':
      return 'TRANSPORTER';
    case 'customer':
      return 'CUSTOMER';
    case 'driver':
      return 'DRIVER';
    case 'admin':
      return 'ADMIN';
    default:
      return 'SYSTEM';
  }
};

const buildVehicleQuery = (trip) => {
  if (trip.vehicleId) {
    return { vehicleId: trip.vehicleId };
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return { 'hiredVehicle.vehicleNumber': trip.hiredVehicle.vehicleNumber };
  }

  return null;
};

const getVehicleRoom = (trip) => {
  if (trip.vehicleId) {
    return `vehicle:${trip.vehicleId}`;
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return `vehicle:hired:${trip.hiredVehicle.vehicleNumber}`;
  }

  return null;
};

const triggerWatiTemplate = async (handler, contextLabel) => {
  try {
    await handler();
  } catch (error) {
    console.error(`WATI ${contextLabel} failed:`, error.message);
  }
};

/**
 * Start trip
 * PUT /api/trips/:id/start
 */
const startTrip = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userType = req.user.userType;

    // Find trip
    const trip = await Trip.findById(id).populate('vehicleId', 'vehicleNumber status ownerType');
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access
    if (userType === 'transporter') {
      // Transporter can start any trip they own
      if (trip.transporterId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to start this trip.',
        });
      }
    } else if (userType === 'driver') {
      // Driver can only start trips assigned to them
      if (!trip.driverId || trip.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This trip is not assigned to you.',
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and drivers can start trips.',
      });
    }

    // Validate trip status
    if (trip.status !== TRIP_STATUS.PLANNED) {
      return res.status(400).json({
        success: false,
        message: `Trip cannot be started. Current status: ${trip.status}`,
      });
    }

    const vehicleQuery = buildVehicleQuery(trip);
    if (!vehicleQuery) {
      return res.status(400).json({
        success: false,
        message: 'Trip must have an assigned owned or hired vehicle before it can start',
      });
    }

    if (!trip.driverId) {
      return res.status(400).json({
        success: false,
        message: 'Trip must have an assigned driver before it can start',
      });
    }

    // Validate vehicle has no other active trip
    const hasActiveTrip = await checkVehicleHasActiveTrip(vehicleQuery, trip._id.toString());
    if (hasActiveTrip) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle already has an active trip. Please complete or cancel the active trip first.',
      });
    }

    // Validate owned vehicle status
    if (trip.vehicleId && trip.vehicleId.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Vehicle is not active',
      });
    }

    // Update trip status
    trip.status = TRIP_STATUS.ACTIVE;
    trip.audit.updatedBy = {
      userId,
      userType: toAuditUserType(userType),
    };
    await trip.save();

    // Get current milestone info
    const currentMilestone = trip.getCurrentMilestone();
    const milestoneLabel = currentMilestone ? getDriverLabel(currentMilestone.milestoneType) : null;

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company mobile');
    await trip.populate('customerId', 'name mobile');

    emitTripStarted(
      trip,
      currentMilestone
        ? {
            milestoneNumber: currentMilestone.milestoneNumber,
            milestoneType: currentMilestone.milestoneType,
            label: milestoneLabel,
          }
        : null
    );

    res.json({
      success: true,
      message: 'Trip started successfully',
      data: {
        ...trip.toObject(),
        currentMilestone: currentMilestone
          ? {
              milestoneNumber: currentMilestone.milestoneNumber,
              milestoneType: currentMilestone.milestoneType,
              label: milestoneLabel,
            }
          : null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Complete trip
 * PUT /api/trips/:id/complete
 */
const completeTrip = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userType = req.user.userType;

    // Find trip
    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access
    if (userType === 'transporter') {
      // Transporter can complete any trip they own
      if (trip.transporterId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to complete this trip.',
        });
      }
    } else if (userType === 'driver') {
      // Driver can only complete trips assigned to them
      if (!trip.driverId || trip.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This trip is not assigned to you.',
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and drivers can complete trips.',
      });
    }

    // Validate trip status
    if (trip.status !== TRIP_STATUS.ACTIVE) {
      return res.status(400).json({
        success: false,
        message: `Trip cannot be completed. Current status: ${trip.status}`,
      });
    }

    // Validate all milestones are completed
    if (!trip.areAllMilestonesCompleted()) {
      return res.status(400).json({
        success: false,
        message: 'All 5 milestones must be completed before completing the trip',
        data: {
          completedMilestones: trip.milestones.length,
          requiredMilestones: 5,
        },
      });
    }

    // Milestone completion moves the trip into POD pending, not closed.
    trip.completedAt = new Date();
    trip.podDueAt = calculatePodDueAt(trip.completedAt);
    trip.podTimerStartedAt = trip.completedAt;
    trip.closedAt = null;
    trip.closedReason = null;
    trip.status = TRIP_STATUS.POD_PENDING;
    trip.audit.updatedBy = {
      userId,
      userType: toAuditUserType(userType),
    };
    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company mobile');
    await trip.populate('customerId', 'name mobile');

    emitTripPodPending(trip);
    emitTripCompleted(trip);

    try {
      const nextTrip = await activateNextTrip(trip);
      if (nextTrip) {
        emitTripAutoActivated(nextTrip);
      }
    } catch (queueError) {
      console.error('Error in auto-queue after trip completion:', queueError);
    }

    if (trip.customerId) {
      await triggerWatiTemplate(
        () =>
          sendTripCompletedTemplate({
            recipient: trip.customerId,
            trip,
            recipientKey: 'customer',
          }),
        'trip completed template for customer'
      );
    }

    if (trip.transporterId) {
      await triggerWatiTemplate(
        () =>
          sendTripCompletedTemplate({
            recipient: trip.transporterId,
            trip,
            recipientKey: 'transporter',
          }),
        'trip completed template for transporter'
      );
    }

    res.json({
      success: true,
      message: 'Trip completed. POD is now pending.',
      data: trip,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Close trip without POD after the POD deadline.
 * PUT /api/trips/:id/close-without-pod
 */
const closeTripWithoutPOD = async (req, res, next) => {
  try {
    const { id } = req.params;
    const isAdmin = req.user.userType === 'admin';
    const transporterId = req.user.id;

    if (!isAdmin && req.user.userType !== 'transporter') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters or admins can close trips without POD.',
      });
    }

    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    if (!isAdmin && trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to close this trip.',
      });
    }

    if (trip.status !== TRIP_STATUS.POD_PENDING) {
      return res.status(400).json({
        success: false,
        message: `Trip can only be closed without POD from POD_PENDING. Current status: ${trip.status}`,
      });
    }

    if (trip.POD?.photo) {
      return res.status(400).json({
        success: false,
        message: 'POD has already been uploaded. Approve the POD instead of closing without POD.',
      });
    }

    if (trip.podDueAt && trip.podDueAt > new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Trip cannot be closed without POD before the 72-hour POD window expires.',
        data: {
          podDueAt: trip.podDueAt,
        },
      });
    }

    trip.status = TRIP_STATUS.CLOSED_WITHOUT_POD;
    trip.closedAt = new Date();
    trip.closedReason = 'POD_TIMEOUT';
    trip.audit.updatedBy = {
      userId: req.user.id,
      userType: toAuditUserType(req.user.userType),
    };
    await trip.save();

    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company mobile');
    await trip.populate('customerId', 'name mobile');

    emitTripClosedWithoutPOD(trip);

    try {
      const nextTrip = await activateNextTrip(trip);
      if (nextTrip) {
        emitTripAutoActivated(nextTrip);
      }
    } catch (queueError) {
      console.error('Error in auto-queue after trip closure without POD:', queueError);
    }

    return res.status(200).json({
      success: true,
      message: 'Trip closed without POD successfully',
      data: trip,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startTrip,
  completeTrip,
  closeTripWithoutPOD,
};
