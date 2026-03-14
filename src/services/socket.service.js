const { Server } = require('socket.io');
const { verifyToken } = require('./jwt.service');
const Transporter = require('../models/Transporter');
const Driver = require('../models/Driver');
const Trip = require('../models/Trip');
const Customer = require('../models/Customer');
const { activateNextTrip } = require('./tripQueue.service');
const { getMilestoneTypeByNumber, getBackendMeaning, getDriverLabel } = require('../utils/milestoneMapping');
const { TRIP_STATUS, calculatePodDueAt } = require('../utils/tripState');
const { ensureMilestonePhoto, toAuditUserType } = require('./tripLifecycle.service');

let io = null;

const getTripVehicleSelector = (trip) => {
  if (trip.vehicleId) {
    return { vehicleId: trip.vehicleId };
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return { 'hiredVehicle.vehicleNumber': trip.hiredVehicle.vehicleNumber };
  }

  return null;
};

const getTripVehicleRoom = (trip) => {
  if (trip.vehicleId) {
    return `vehicle:${trip.vehicleId}`;
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return `vehicle:hired:${trip.hiredVehicle.vehicleNumber}`;
  }

  return null;
};

const emitToTripAudience = (eventName, payload) => {
  if (!io || !payload?.trip) {
    return;
  }

  const trip = payload.trip;

  if (trip.transporterId) {
    io.to(`transporter:${trip.transporterId._id || trip.transporterId}`).emit(eventName, payload);
  }

  if (trip.driverId) {
    io.to(`driver:${trip.driverId._id || trip.driverId}`).emit(eventName, payload);
  }

  if (trip.customerId) {
    io.to(`customer:${trip.customerId._id || trip.customerId}`).emit(eventName, payload);
  }

  const vehicleRoom = getTripVehicleRoom(trip);
  if (vehicleRoom) {
    io.to(vehicleRoom).emit(eventName, payload);
  }

  io.to(`trip:${trip._id || trip.id}`).emit(eventName, payload);
};

/**
 * Initialize Socket.IO server
 * @param {Object} httpServer - HTTP server instance
 * @returns {Object} Socket.IO server instance
 */
const initializeSocketIO = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*', // Configure based on your frontend URL
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Authentication middleware for Socket.IO
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return next(new Error('Authentication error: No token provided'));
      }

      try {
        const decoded = verifyToken(token);

        // Fetch user based on userType
        let user = null;
        if (decoded.userType === 'transporter') {
          user = await Transporter.findById(decoded.userId);
        } else if (decoded.userType === 'driver') {
          user = await Driver.findById(decoded.userId);
        } else if (decoded.userType === 'customer') {
          user = await Customer.findById(decoded.userId);
        }

        if (!user) {
          return next(new Error('Authentication error: User not found'));
        }

        if (user.status === 'blocked') {
          return next(new Error('Authentication error: Account blocked'));
        }

        // Attach user to socket
        socket.user = {
          id: user._id.toString(),
          mobile: user.mobile,
          userType: decoded.userType,
          userData: user,
        };

        next();
      } catch (tokenError) {
        return next(new Error(`Authentication error: ${tokenError.message}`));
      }
    } catch (error) {
      next(new Error(`Authentication error: ${error.message}`));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id} (${socket.user.userType}: ${socket.user.id})`);

    // Join user-specific rooms
    if (socket.user.userType === 'transporter') {
      socket.join(`transporter:${socket.user.id}`);
    } else if (socket.user.userType === 'driver') {
      socket.join(`driver:${socket.user.id}`);
    } else if (socket.user.userType === 'customer') {
      socket.join(`customer:${socket.user.id}`);
    }

    // Handle room joins
    socket.on('join:transporter', (transporterId) => {
      if (socket.user.userType === 'transporter' && socket.user.id === transporterId) {
        socket.join(`transporter:${transporterId}`);
        console.log(`Socket ${socket.id} joined transporter:${transporterId}`);
      }
    });

    socket.on('join:driver', (driverId) => {
      if (socket.user.userType === 'driver' && socket.user.id === driverId) {
        socket.join(`driver:${driverId}`);
        console.log(`Socket ${socket.id} joined driver:${driverId}`);
      }
    });

    socket.on('join:customer', (customerId) => {
      if (socket.user.userType === 'customer' && socket.user.id === customerId) {
        socket.join(`customer:${customerId}`);
        console.log(`Socket ${socket.id} joined customer:${customerId}`);
      }
    });

    socket.on('join:vehicle', (vehicleId) => {
      socket.join(`vehicle:${vehicleId}`);
      console.log(`Socket ${socket.id} joined vehicle:${vehicleId}`);
    });

    socket.on('join:trip', (tripId) => {
      socket.join(`trip:${tripId}`);
      console.log(`Socket ${socket.id} joined trip:${tripId}`);
    });

    // Handle trip start (from driver app)
    socket.on('trip:start', async (data) => {
      try {
        const { tripId } = data;

        if (!tripId) {
          return socket.emit('error', { message: 'Trip ID is required' });
        }

        // Only drivers can start trips via Socket.IO
        if (socket.user.userType !== 'driver') {
          return socket.emit('error', { message: 'Only drivers can start trips' });
        }

        // Find trip
        const trip = await Trip.findById(tripId);
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' });
        }

        // Check driver access
        if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
          return socket.emit('error', { message: 'Access denied. This trip is not assigned to you.' });
        }

        // Validate trip status
        if (trip.status !== TRIP_STATUS.PLANNED) {
          return socket.emit('error', { message: `Trip cannot be started. Current status: ${trip.status}` });
        }

        const vehicleSelector = getTripVehicleSelector(trip);
        if (!vehicleSelector) {
          return socket.emit('error', { message: 'Trip must have an assigned owned or hired vehicle' });
        }

        if (!trip.driverId) {
          return socket.emit('error', { message: 'Trip must have an assigned driver' });
        }

        // Check for active trip on vehicle
        const activeTrip = await Trip.findOne({
          ...vehicleSelector,
          status: TRIP_STATUS.ACTIVE,
          _id: { $ne: trip._id },
        });

        if (activeTrip) {
          return socket.emit('error', { message: 'Vehicle already has an active trip' });
        }

        // Update trip status
        trip.status = TRIP_STATUS.ACTIVE;
        await trip.save();

        // Get current milestone
        const currentMilestone = trip.getCurrentMilestone();
        const milestoneLabel = currentMilestone ? getDriverLabel(currentMilestone.milestoneType) : null;

        // Broadcast trip started event
        io.to(`transporter:${trip.transporterId}`).emit('trip:started', {
          trip: trip.toObject(),
          currentMilestone: currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel,
              }
            : null,
        });

        io.to(`driver:${socket.user.id}`).emit('trip:started', {
          trip: trip.toObject(),
          currentMilestone: currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel,
              }
            : null,
        });

        const vehicleRoom = getTripVehicleRoom(trip);
        if (vehicleRoom) {
          io.to(vehicleRoom).emit('trip:started', {
            trip: trip.toObject(),
          });
        }

        io.to(`trip:${tripId}`).emit('trip:started', {
          trip: trip.toObject(),
        });
      } catch (error) {
        console.error('Error handling trip:start:', error);
        socket.emit('error', { message: error.message || 'Failed to start trip' });
      }
    });

    // Handle milestone update (from driver app)
    socket.on('trip:milestone:update', async (data) => {
      try {
        const { tripId, milestoneNumber, latitude, longitude, photo } = data;

        if (!tripId || !milestoneNumber || latitude === undefined || longitude === undefined) {
          return socket.emit('error', { message: 'Trip ID, milestone number, and GPS location are required' });
        }

        // Only drivers can update milestones
        if (socket.user.userType !== 'driver') {
          return socket.emit('error', { message: 'Only drivers can update milestones' });
        }

        const milestoneNum = parseInt(milestoneNumber);
        if (milestoneNum < 1 || milestoneNum > 5) {
          return socket.emit('error', { message: 'Milestone number must be between 1 and 5' });
        }

        // Find trip
        const trip = await Trip.findById(tripId);
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' });
        }

        // Check driver access
        if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
          return socket.emit('error', { message: 'Access denied. This trip is not assigned to you.' });
        }

        // Validate trip is ACTIVE
        if (trip.status !== TRIP_STATUS.ACTIVE) {
          return socket.emit('error', { message: `Milestones can only be updated for ACTIVE trips. Current status: ${trip.status}` });
        }

        // Validate milestone sequence
        const completedMilestones = trip.milestones.length;
        const expectedNext = completedMilestones + 1;

        if (milestoneNum !== expectedNext) {
          return socket.emit('error', {
            message: `Invalid milestone sequence. Expected milestone ${expectedNext}, got ${milestoneNum}`,
          });
        }

        // Get milestone type and backend meaning
        const milestoneType = getMilestoneTypeByNumber(milestoneNum);
        const backendMeaning = getBackendMeaning(milestoneType, trip.tripType);

        const photoValidationError = ensureMilestonePhoto(trip, milestoneType, photo || null);
        if (photoValidationError) {
          return socket.emit('error', { message: photoValidationError });
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
          photo: photo || null,
          driverId: socket.user.id,
          backendMeaning,
        };

        // Add milestone to trip
        trip.milestones.push(milestone);
        trip.audit.updatedBy = {
          userId: socket.user.id,
          userType: toAuditUserType(socket.user.userType),
        };
        await trip.save();

        // Get current milestone for next milestone
        const currentMilestone = trip.getCurrentMilestone();
        const milestoneLabel = currentMilestone ? getDriverLabel(currentMilestone.milestoneType) : null;

        // Broadcast milestone updated event
        io.to(`transporter:${trip.transporterId}`).emit('trip:milestone:updated', {
          trip: trip.toObject(),
          milestone,
          currentMilestone: currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel,
              }
            : null,
        });

        io.to(`driver:${socket.user.id}`).emit('trip:milestone:updated', {
          trip: trip.toObject(),
          milestone,
          currentMilestone: currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel,
              }
            : null,
        });

        if (trip.customerId) {
          io.to(`customer:${trip.customerId}`).emit('trip:milestone:updated', {
            trip: trip.toObject(),
            milestone,
            currentMilestone: currentMilestone
              ? {
                  milestoneNumber: currentMilestone.milestoneNumber,
                  milestoneType: currentMilestone.milestoneType,
                  label: milestoneLabel,
                }
              : null,
          });
        }

        const vehicleRoom = getTripVehicleRoom(trip);
        if (vehicleRoom) {
          io.to(vehicleRoom).emit('trip:milestone:updated', {
            trip: trip.toObject(),
            milestone,
          });
        }

        io.to(`trip:${tripId}`).emit('trip:milestone:updated', {
          trip: trip.toObject(),
          milestone,
        });
      } catch (error) {
        console.error('Error handling trip:milestone:update:', error);
        socket.emit('error', { message: error.message || 'Failed to update milestone' });
      }
    });

    // Handle trip complete (from driver app)
    socket.on('trip:complete', async (data) => {
      try {
        const { tripId } = data;

        if (!tripId) {
          return socket.emit('error', { message: 'Trip ID is required' });
        }

        // Only drivers can complete trips via Socket.IO
        if (socket.user.userType !== 'driver') {
          return socket.emit('error', { message: 'Only drivers can complete trips' });
        }

        // Find trip
        const trip = await Trip.findById(tripId);
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' });
        }

        // Check driver access
        if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
          return socket.emit('error', { message: 'Access denied. This trip is not assigned to you.' });
        }

        // Validate trip status
        if (trip.status !== TRIP_STATUS.ACTIVE) {
          return socket.emit('error', { message: `Trip cannot be completed. Current status: ${trip.status}` });
        }

        // Validate all milestones are completed
        if (!trip.areAllMilestonesCompleted()) {
          return socket.emit('error', {
            message: 'All 5 milestones must be completed before completing the trip',
            completedMilestones: trip.milestones.length,
            requiredMilestones: 5,
          });
        }

        // Milestone completion moves the trip to POD pending.
        trip.completedAt = new Date();
        trip.podDueAt = calculatePodDueAt(trip.completedAt);
        trip.closedAt = null;
        trip.closedReason = null;
        trip.status = TRIP_STATUS.POD_PENDING;
        trip.podTimerStartedAt = trip.completedAt;
        trip.audit.updatedBy = {
          userId: socket.user.id,
          userType: toAuditUserType(socket.user.userType),
        };
        await trip.save();

        // Broadcast pod pending event
        io.to(`transporter:${trip.transporterId}`).emit('trip:pod:pending', {
          trip: trip.toObject(),
        });

        io.to(`driver:${socket.user.id}`).emit('trip:pod:pending', {
          trip: trip.toObject(),
        });

        if (trip.customerId) {
          io.to(`customer:${trip.customerId}`).emit('trip:pod:pending', {
            trip: trip.toObject(),
          });
        }

        const vehicleRoom = getTripVehicleRoom(trip);
        if (vehicleRoom) {
          io.to(vehicleRoom).emit('trip:pod:pending', {
            trip: trip.toObject(),
          });
        }

        io.to(`trip:${tripId}`).emit('trip:pod:pending', {
          trip: trip.toObject(),
        });

        // Auto-activate next queued trip
        try {
          const nextTrip = await activateNextTrip(trip);
          if (nextTrip) {
            // Notify driver about next trip
            if (nextTrip.driverId) {
              io.to(`driver:${nextTrip.driverId}`).emit('trip:auto-activated', {
                trip: nextTrip.toObject(),
                message: 'Next trip has been auto-activated',
              });
            }

            // Notify transporter
            io.to(`transporter:${nextTrip.transporterId}`).emit('trip:auto-activated', {
              trip: nextTrip.toObject(),
            });
          }
        } catch (queueError) {
          console.error('Error in auto-queue after trip completion:', queueError);
          // Don't fail the trip completion if auto-queue fails
        }
      } catch (error) {
        console.error('Error handling trip:complete:', error);
        socket.emit('error', { message: error.message || 'Failed to complete trip' });
      }
    });

    // Disconnection handler
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

/**
 * Get Socket.IO instance
 * @returns {Object} Socket.IO server instance
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocketIO first.');
  }
  return io;
};

/**
 * Emit trip created event
 * @param {String} transporterId - Transporter ID
 * @param {Object} trip - Trip object
 */
const emitTripCreated = (transporterId, trip) => {
  if (io) {
    io.to(`transporter:${transporterId}`).emit('trip:created', {
      trip: trip.toObject ? trip.toObject() : trip,
    });
  }
};

const emitBookingAccepted = (trip) => {
  emitToTripAudience('trip:customer:accepted', {
    trip: trip.toObject ? trip.toObject() : trip,
  });
};

const emitBookingRejected = ({ trip, transporterId }) => {
  if (!io) {
    return;
  }

  const tripData = trip.toObject ? trip.toObject() : trip;
  if (tripData.customerId) {
    io.to(`customer:${tripData.customerId._id || tripData.customerId}`).emit('trip:customer:rejected', {
      trip: tripData,
      transporterId,
    });
  }
  io.to(`transporter:${transporterId}`).emit('trip:customer:rejected', {
    tripId: tripData._id || tripData.id,
  });
};

const emitTripVehicleAssigned = (trip, assignment) => {
  emitToTripAudience('trip:vehicle:assigned', {
    trip: trip.toObject ? trip.toObject() : trip,
    assignment,
  });
};

const emitTripDriverAssigned = (trip, assignment) => {
  emitToTripAudience('trip:driver:assigned', {
    trip: trip.toObject ? trip.toObject() : trip,
    assignment,
  });
};

const emitTripAssigned = (trip, assignment = {}) => {
  emitToTripAudience('trip:customer:assigned', {
    trip: trip.toObject ? trip.toObject() : trip,
    assignment,
  });
};

const emitTripStarted = (trip, currentMilestone = null) => {
  emitToTripAudience('trip:started', {
    trip: trip.toObject ? trip.toObject() : trip,
    currentMilestone,
  });
};

const emitTripMilestoneUpdated = (trip, milestone, currentMilestone = null) => {
  emitToTripAudience('trip:milestone:updated', {
    trip: trip.toObject ? trip.toObject() : trip,
    milestone,
    currentMilestone,
  });
};

const emitTripPodUploaded = (trip) => {
  emitToTripAudience('trip:pod:uploaded', {
    trip: trip.toObject ? trip.toObject() : trip,
  });
};

const emitTripCompleted = (trip) => {
  emitToTripAudience('trip:completed', {
    trip: trip.toObject ? trip.toObject() : trip,
  });
};

const emitTripPodPending = (trip) => {
  emitToTripAudience('trip:pod:pending', {
    trip: trip.toObject ? trip.toObject() : trip,
  });
};

const emitTripClosedWithPOD = (trip) => {
  emitToTripAudience('trip:closed:with-pod', {
    trip: trip.toObject ? trip.toObject() : trip,
  });
};

const emitTripClosedWithoutPOD = (trip) => {
  emitToTripAudience('trip:closed:without-pod', {
    trip: trip.toObject ? trip.toObject() : trip,
  });
};

const emitTripAutoActivated = (trip) => {
  emitToTripAudience('trip:auto-activated', {
    trip: trip.toObject ? trip.toObject() : trip,
    message: 'Next trip has been auto-activated',
  });
};

/**
 * Emit vehicle status updated event
 * @param {String} vehicleId - Vehicle ID
 * @param {String} transporterId - Transporter ID
 * @param {Object} vehicle - Vehicle object
 */
const emitVehicleStatusUpdated = (vehicleId, transporterId, vehicle) => {
  if (io) {
    io.to(`vehicle:${vehicleId}`).emit('vehicle:status:updated', {
      vehicle: vehicle.toObject ? vehicle.toObject() : vehicle,
    });
    io.to(`transporter:${transporterId}`).emit('vehicle:status:updated', {
      vehicle: vehicle.toObject ? vehicle.toObject() : vehicle,
    });
  }
};

module.exports = {
  initializeSocketIO,
  getIO,
  emitTripCreated,
  emitBookingAccepted,
  emitBookingRejected,
  emitTripVehicleAssigned,
  emitTripDriverAssigned,
  emitTripAssigned,
  emitTripStarted,
  emitTripMilestoneUpdated,
  emitTripPodUploaded,
  emitTripCompleted,
  emitTripPodPending,
  emitTripClosedWithPOD,
  emitTripClosedWithoutPOD,
  emitTripAutoActivated,
  emitVehicleStatusUpdated,
};
