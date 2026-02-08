const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const { checkVehicleHasActiveTrip } = require('../utils/vehicleValidation');
const { getMilestoneTypeByNumber, getDriverLabel } = require('../utils/milestoneMapping');
const { getIO } = require('../services/socket.service');
const { activateNextTrip } = require('../services/tripQueue.service');

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
    const trip = await Trip.findById(id).populate('vehicleId', 'vehicleNumber status');
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
    if (trip.status !== 'PLANNED') {
      return res.status(400).json({
        success: false,
        message: `Trip cannot be started. Current status: ${trip.status}`,
      });
    }

    // Validate vehicle has no other active trip
    const hasActiveTrip = await checkVehicleHasActiveTrip(trip.vehicleId._id.toString());
    if (hasActiveTrip) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle already has an active trip. Please complete or cancel the active trip first.',
      });
    }

    // Validate vehicle status
    if (trip.vehicleId.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Vehicle is not active',
      });
    }

    // Update trip status
    trip.status = 'ACTIVE';
    await trip.save();

    // Get current milestone info
    const currentMilestone = trip.getCurrentMilestone();
    const milestoneLabel = currentMilestone ? getDriverLabel(currentMilestone.milestoneType) : null;

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    // Emit Socket.IO event
    try {
      const io = getIO();
      const tripData = {
        trip: trip.toObject(),
        currentMilestone: currentMilestone
          ? {
              milestoneNumber: currentMilestone.milestoneNumber,
              milestoneType: currentMilestone.milestoneType,
              label: milestoneLabel,
            }
          : null,
      };

      io.to(`transporter:${trip.transporterId}`).emit('trip:started', tripData);
      if (trip.driverId) {
        io.to(`driver:${trip.driverId}`).emit('trip:started', tripData);
      }
      io.to(`vehicle:${trip.vehicleId}`).emit('trip:started', tripData);
      io.to(`trip:${trip._id}`).emit('trip:started', tripData);
    } catch (socketError) {
      console.error('Error emitting trip:started event:', socketError);
      // Don't fail the request if socket emit fails
    }

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
    if (trip.status !== 'ACTIVE') {
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

    // Update trip status
    trip.status = 'COMPLETED';
    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    // Emit Socket.IO event
    try {
      const io = getIO();
      const tripData = { trip: trip.toObject() };

      io.to(`transporter:${trip.transporterId}`).emit('trip:completed', tripData);
      io.to(`vehicle:${trip.vehicleId}`).emit('trip:completed', tripData);
      io.to(`trip:${trip._id}`).emit('trip:completed', tripData);

      // Auto-activate next queued trip
      try {
        const nextTrip = await activateNextTrip(trip.vehicleId.toString());
        if (nextTrip) {
          // Notify driver about next trip
          if (nextTrip.driverId) {
            io.to(`driver:${nextTrip.driverId}`).emit('trip:auto-activated', {
              trip: nextTrip.toObject ? nextTrip.toObject() : nextTrip,
              message: 'Next trip has been auto-activated',
            });
          }

          // Notify transporter
          io.to(`transporter:${nextTrip.transporterId}`).emit('trip:auto-activated', {
            trip: nextTrip.toObject ? nextTrip.toObject() : nextTrip,
          });
        }
      } catch (queueError) {
        console.error('Error in auto-queue after trip completion:', queueError);
        // Don't fail the trip completion if auto-queue fails
      }
    } catch (socketError) {
      console.error('Error emitting trip:completed event:', socketError);
      // Don't fail the request if socket emit fails
    }

    res.json({
      success: true,
      message: 'Trip completed successfully',
      data: trip,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  startTrip,
  completeTrip,
};
