const Trip = require('../models/Trip');
const { getBackendMeaning, getDriverLabel, getMilestoneTypeByNumber } = require('../utils/milestoneMapping');
const { getIO } = require('../services/socket.service');
const path = require('path');

/**
 * Update milestone
 * POST /api/trips/:id/milestones/:milestoneNumber
 */
const updateMilestone = async (req, res, next) => {
  try {
    const { id, milestoneNumber } = req.params;
    const userId = req.user.id;
    const userType = req.user.userType;

    // Only drivers can update milestones
    if (userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can update milestones.',
      });
    }

    const milestoneNum = parseInt(milestoneNumber);
    if (milestoneNum < 1 || milestoneNum > 5) {
      return res.status(400).json({
        success: false,
        message: 'Milestone number must be between 1 and 5',
      });
    }

    // Find trip
    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check driver access
    if (!trip.driverId || trip.driverId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This trip is not assigned to you.',
      });
    }

    // Validate trip is ACTIVE
    if (trip.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: `Milestones can only be updated for ACTIVE trips. Current status: ${trip.status}`,
      });
    }

    // Validate milestone sequence (cannot skip)
    const completedMilestones = trip.milestones.length;
    const expectedNext = completedMilestones + 1;

    if (milestoneNum !== expectedNext) {
      return res.status(400).json({
        success: false,
        message: `Invalid milestone sequence. Expected milestone ${expectedNext}, got ${milestoneNum}. Milestones must be completed in order.`,
        data: {
          completedMilestones: completedMilestones,
          expectedNext: expectedNext,
          received: milestoneNum,
        },
      });
    }

    // Get GPS location from request body (required)
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'GPS location is required (latitude and longitude)',
      });
    }

    // Validate coordinates
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude must be numbers',
      });
    }

    if (latitude < -90 || latitude > 90) {
      return res.status(400).json({
        success: false,
        message: 'Latitude must be between -90 and 90',
      });
    }

    if (longitude < -180 || longitude > 180) {
      return res.status(400).json({
        success: false,
        message: 'Longitude must be between -180 and 180',
      });
    }

    // Get milestone type
    const milestoneType = getMilestoneTypeByNumber(milestoneNum);

    // Get backend meaning based on trip type
    const backendMeaning = getBackendMeaning(milestoneType, trip.tripType);

    // Get photo URL if file was uploaded
    let photoUrl = null;
    if (req.file) {
      // File path relative to uploads directory
      photoUrl = `/uploads/milestones/${req.file.filename}`;
    }

    // Create milestone object
    const milestone = {
      milestoneType,
      milestoneNumber: milestoneNum,
      timestamp: new Date(),
      location: {
        latitude,
        longitude,
      },
      photo: photoUrl,
      driverId: userId,
      backendMeaning,
    };

    // Add milestone to trip
    trip.milestones.push(milestone);
    await trip.save();

    // Get current milestone info for next milestone
    const currentMilestone = trip.getCurrentMilestone();
    const milestoneLabel = currentMilestone ? getDriverLabel(currentMilestone.milestoneType) : null;

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    // Emit Socket.IO event
    try {
      const io = getIO();
      const milestoneData = {
        trip: trip.toObject(),
        milestone,
        currentMilestone: currentMilestone
          ? {
              milestoneNumber: currentMilestone.milestoneNumber,
              milestoneType: currentMilestone.milestoneType,
              label: milestoneLabel,
            }
          : null,
      };

      io.to(`transporter:${trip.transporterId}`).emit('trip:milestone:updated', milestoneData);
      io.to(`driver:${userId}`).emit('trip:milestone:updated', milestoneData);
      io.to(`vehicle:${trip.vehicleId}`).emit('trip:milestone:updated', milestoneData);
      io.to(`trip:${trip._id}`).emit('trip:milestone:updated', milestoneData);
    } catch (socketError) {
      console.error('Error emitting trip:milestone:updated event:', socketError);
      // Don't fail the request if socket emit fails
    }

    res.json({
      success: true,
      message: `Milestone ${milestoneNum} updated successfully`,
      data: {
        trip,
        milestone,
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
 * Get current milestone
 * GET /api/trips/:id/current-milestone
 */
const getCurrentMilestone = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    const userType = req.user?.userType;

    // Find trip
    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access for drivers
    if (userType === 'driver') {
      if (!trip.driverId || trip.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This trip is not assigned to you.',
        });
      }
    } else if (userType === 'transporter') {
      if (trip.transporterId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.',
        });
      }
    }

    // Get current milestone
    const currentMilestone = trip.getCurrentMilestone();

    if (!currentMilestone) {
      return res.json({
        success: true,
        message: 'All milestones completed',
        data: {
          completed: true,
          milestoneNumber: null,
          milestoneType: null,
          label: null,
        },
      });
    }

    const milestoneLabel = getDriverLabel(currentMilestone.milestoneType);

    res.json({
      success: true,
      data: {
        completed: false,
        milestoneNumber: currentMilestone.milestoneNumber,
        milestoneType: currentMilestone.milestoneType,
        label: milestoneLabel,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get trip timeline
 * GET /api/trips/:id/timeline
 */
const getTripTimeline = async (req, res, next) => {
  try {
    // Only transporters can view timeline
    if (req.user.userType !== 'transporter') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters can view trip timeline.',
      });
    }

    const { id } = req.params;
    const transporterId = req.user.id;

    // Find trip
    const trip = await Trip.findById(id)
      .populate('driverId', 'name mobile')
      .populate('vehicleId', 'vehicleNumber');

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access
    if (trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view this trip.',
      });
    }

    // Build timeline with all 5 milestones
    const allMilestones = [
      'CONTAINER_PICKED',
      'REACHED_LOCATION',
      'LOADING_UNLOADING',
      'REACHED_DESTINATION',
      'TRIP_COMPLETED',
    ];

    const timeline = allMilestones.map((milestoneType, index) => {
      const milestoneNumber = index + 1;
      const completedMilestone = trip.milestones.find((m) => m.milestoneNumber === milestoneNumber);

      return {
        milestoneNumber,
        milestoneType,
        driverLabel: getDriverLabel(milestoneType),
        backendMeaning: completedMilestone ? completedMilestone.backendMeaning : null,
        completed: !!completedMilestone,
        timestamp: completedMilestone ? completedMilestone.timestamp : null,
        location: completedMilestone ? completedMilestone.location : null,
        photo: completedMilestone ? completedMilestone.photo : null,
        driverId: completedMilestone ? completedMilestone.driverId : null,
      };
    });

    res.json({
      success: true,
      data: {
        trip: {
          tripId: trip.tripId,
          status: trip.status,
          tripType: trip.tripType,
          containerNumber: trip.containerNumber,
          reference: trip.reference,
        },
        timeline,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  updateMilestone,
  getCurrentMilestone,
  getTripTimeline,
};
