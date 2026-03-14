const Trip = require('../models/Trip');
const path = require('path');
const { TRIP_STATUS } = require('../utils/tripState');
const {
  emitTripPodUploaded,
  emitTripClosedWithPOD,
  emitTripAutoActivated,
} = require('../services/socket.service');
const { activateNextTrip } = require('../services/tripQueue.service');
const { autoCloseTripIfExpired, toAuditUserType } = require('../services/tripLifecycle.service');

const getVehicleRoom = (trip) => {
  if (trip.vehicleId) {
    return `vehicle:${trip.vehicleId}`;
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return `vehicle:hired:${trip.hiredVehicle.vehicleNumber}`;
  }

  return null;
};

/**
 * Upload POD
 * POST /api/trips/:id/pod
 */
const uploadPOD = async (req, res, next) => {
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

    // POD upload is driver-only.
    if (userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can upload POD.',
      });
    }

    const { autoClosed } = await autoCloseTripIfExpired(trip, {
      userId,
      userType,
    });
    if (autoClosed) {
      return res.status(400).json({
        success: false,
        message: 'POD upload window has expired. The trip was auto-closed without POD.',
        data: trip,
      });
    }

    if (!trip.driverId || trip.driverId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This trip is not assigned to you.',
      });
    }

    // Validate trip status - POD can be uploaded only while POD is pending
    if (trip.status !== TRIP_STATUS.POD_PENDING) {
      return res.status(400).json({
        success: false,
        message: `POD can only be uploaded when status is POD_PENDING. Current status: ${trip.status}`,
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'POD photo is required',
      });
    }

    // Get photo URL
    const photoUrl = `/uploads/pod/${req.file.filename}`;

    // Update trip POD
    trip.POD = {
      photo: photoUrl,
      uploadedAt: new Date(),
      uploadedBy: userId,
      approvedAt: null,
      approvedBy: null,
    };
    trip.audit.updatedBy = {
      userId,
      userType: toAuditUserType(userType),
    };

    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');
    await trip.populate('customerId', 'name mobile');

    emitTripPodUploaded(trip);

    res.json({
      success: true,
      message: 'POD uploaded successfully',
      data: trip,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Approve POD
 * PUT /api/trips/:id/pod/approve
 */
const approvePOD = async (req, res, next) => {
  try {
    // Only transporters can approve POD
    if (req.user.userType !== 'transporter') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters can approve POD.',
      });
    }

    const { id } = req.params;
    const transporterId = req.user.id;

    // Find trip
    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    const { autoClosed } = await autoCloseTripIfExpired(trip, {
      userId: transporterId,
      userType: req.user.userType,
    });
    if (autoClosed) {
      return res.status(400).json({
        success: false,
        message: 'POD approval window has expired. The trip was auto-closed without POD.',
        data: trip,
      });
    }

    // Check access
    if (trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to approve POD for this trip.',
      });
    }

    // Validate trip status
    if (trip.status !== TRIP_STATUS.POD_PENDING) {
      return res.status(400).json({
        success: false,
        message: `POD can only be approved when status is POD_PENDING. Current status: ${trip.status}`,
      });
    }

    // Check if POD exists
    if (!trip.POD || !trip.POD.photo) {
      return res.status(400).json({
        success: false,
        message: 'POD has not been uploaded yet',
      });
    }

    // Update POD approval
    trip.POD.approvedAt = new Date();
    trip.POD.approvedBy = transporterId;

    // Update trip status to final closed state
    trip.status = TRIP_STATUS.CLOSED_WITH_POD;
    trip.closedAt = new Date();
    trip.closedReason = 'POD_APPROVED';
    trip.audit.updatedBy = {
      userId: transporterId,
      userType: toAuditUserType(req.user.userType),
    };
    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');
    await trip.populate('customerId', 'name mobile');

    emitTripClosedWithPOD(trip);

    try {
      const nextTrip = await activateNextTrip(trip);
      if (nextTrip) {
        emitTripAutoActivated(nextTrip);
      }
    } catch (queueError) {
      console.error('Error in auto-queue after POD approval:', queueError);
    }

    res.json({
      success: true,
      message: 'POD approved successfully',
      data: trip,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadPOD,
  approvePOD,
};
