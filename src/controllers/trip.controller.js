const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const Customer = require('../models/Customer');
const Transporter = require('../models/Transporter');
const Notification = require('../models/Notification');
const SystemConfig = require('../models/SystemConfig');
const { checkVehicleHasActiveTrip } = require('../utils/vehicleValidation');
const {
  emitTripCreated,
  emitBookingAccepted,
  emitBookingRejected,
  emitTripVehicleAssigned,
  emitTripDriverAssigned,
  emitTripAssigned,
} = require('../services/socket.service');
const { getTransporterId, hasPermission } = require('../middleware/permission.middleware');
const {
  sendTripCreatedConfirmation,
  sendBookingAcceptedTemplate,
  sendDriverVehicleAssignedTemplate,
  sendBookingRejectedTemplate,
  sendBookingRequestReceivedTemplate,
} = require('../services/wati.service');
const { TRIP_STATUS, BOOKING_STATUS, TRIP_STATUS_VALUES } = require('../utils/tripState');
const { buildVisibleTrip } = require('../services/tripVisibility.service');

const TRANSPORTER_VISIBLE_BOOKING_QUERY = {
  bookedBy: 'CUSTOMER',
  status: TRIP_STATUS.BOOKED,
  bookingStatus: BOOKING_STATUS.OPEN,
  acceptedTransporterId: null,
};

const normalizeHiredVehicle = (hiredVehicle) => {
  if (!hiredVehicle) {
    return null;
  }

  return {
    vehicleNumber: hiredVehicle.vehicleNumber?.trim().toUpperCase() || '',
    trailerType: hiredVehicle.trailerType?.trim() || null,
  };
};

const validateVehicleAssignmentInput = ({ vehicleId, hiredVehicle }) => {
  if (vehicleId && hiredVehicle) {
    return 'Provide either vehicleId or hiredVehicle, not both';
  }

  if (hiredVehicle) {
    const normalized = normalizeHiredVehicle(hiredVehicle);
    if (!normalized.vehicleNumber) {
      return 'hiredVehicle.vehicleNumber is required';
    }
  }

  return null;
};

const validateOwnedVehicleAccess = async (vehicleId, transporterId) => {
  const vehicle = await Vehicle.findById(vehicleId);
  if (!vehicle) {
    return { error: 'Vehicle not found', statusCode: 404 };
  }

  if (vehicle.transporterId.toString() !== transporterId) {
    return { error: 'You do not have access to this vehicle', statusCode: 403 };
  }

  if (vehicle.ownerType !== 'OWN') {
    return { error: 'Only owned fleet vehicles can be assigned from the fleet', statusCode: 400 };
  }

  if (vehicle.status !== 'active') {
    return { error: 'Vehicle is not active', statusCode: 400 };
  }

  return { vehicle };
};

const normalizeLocation = (location) => {
  if (!location) {
    return null;
  }

  return {
    address: location.address?.trim() || '',
    coordinates: {
      latitude: location.coordinates.latitude,
      longitude: location.coordinates.longitude,
    },
    city: location.city?.trim() || null,
    state: location.state?.trim() || null,
    pincode: location.pincode?.trim() || null,
  };
};

const validateCoordinates = (location, label) => {
  if (!location || !location.coordinates) {
    return `${label} is required`;
  }

  const { latitude, longitude } = location.coordinates;
  if (latitude === undefined || latitude === null || longitude === undefined || longitude === null) {
    return `${label} must include coordinates (latitude and longitude)`;
  }

  return null;
};

const createNotification = async ({ userId, userType, type, title, message, data = {}, priority = 'medium' }) => {
  await Notification.create({
    userId,
    userType,
    type,
    title,
    message,
    data,
    priority,
  });
};

const serializeTripForRealtime = (trip) => (trip.toObject ? trip.toObject() : trip);

const triggerWatiTemplate = async (handler, contextLabel) => {
  try {
    await handler();
  } catch (error) {
    console.error(`WATI ${contextLabel} failed:`, error.message);
  }
};

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

const setAuditActor = (trip, user) => {
  trip.audit = trip.audit || {};
  trip.audit.updatedBy = {
    userId: user?.id || null,
    userType: toAuditUserType(user?.userType),
  };
};

const serializeTrip = (trip, options = {}) => {
  const tripData = trip?.toObject ? trip.toObject() : trip;
  if (!tripData) {
    return null;
  }

  const currentMilestone =
    options.includeCurrentMilestone && trip.getCurrentMilestone
      ? trip.getCurrentMilestone()
      : null;

  return {
    ...tripData,
    vehicle: tripData.vehicleId
      ? {
          id: tripData.vehicleId._id || tripData.vehicleId,
          vehicleNumber: tripData.vehicleId.vehicleNumber,
          trailerType: tripData.vehicleId.trailerType || null,
          source: 'OWNED_FLEET',
        }
      : tripData.hiredVehicle
        ? {
            id: null,
            vehicleNumber: tripData.hiredVehicle.vehicleNumber,
            trailerType: tripData.hiredVehicle.trailerType || null,
            source: 'HIRED_TRIP_ONLY',
          }
        : null,
    currentMilestone,
  };
};

const serializeTrips = (trips, options = {}) => trips.map((trip) => serializeTrip(trip, options));

const getTripVisibilityResponse = (trip, context = {}) => {
  if (context.includeCurrentMilestone && trip?.getCurrentMilestone) {
    const tripData = trip.toObject ? trip.toObject() : { ...trip };
    tripData.currentMilestone = trip.getCurrentMilestone();
    return buildVisibleTrip(tripData, context);
  }

  return buildVisibleTrip(trip, context);
};

const getDefaultPhotoRules = async () => {
  const config = await SystemConfig.findOne({ key: 'TRIP_RULES' }).select('milestoneRules');
  return config?.milestoneRules || undefined;
};

const populateTripReferences = async (trip) => {
  await trip.populate('vehicleId', 'vehicleNumber trailerType');
  await trip.populate('driverId', 'name mobile status');
  await trip.populate('transporterId', 'name company mobile');
  await trip.populate('customerId', 'name mobile email isRegistered');
  await trip.populate('acceptedTransporterId', 'name company mobile');
  return trip;
};

const buildAssignmentPayload = (trip) => ({
  trip: serializeTripForRealtime(trip),
  assignment: {
    vehicleId: trip.vehicleId?._id || trip.vehicleId || null,
    hiredVehicle: trip.hiredVehicle || null,
    driverId: trip.driverId?._id || trip.driverId || null,
    status: trip.status,
    bookingStatus: trip.bookingStatus,
  },
});

const finalizeAssignmentState = (trip) => {
  if (trip.bookedBy === 'CUSTOMER') {
    if (trip.vehicleId || trip.hiredVehicle) {
      trip.bookingStatus = BOOKING_STATUS.ASSIGNED;
    }

    if ((trip.vehicleId || trip.hiredVehicle) && trip.driverId) {
      trip.status = TRIP_STATUS.PLANNED;
      if (!trip.assignedAt) {
        trip.assignedAt = new Date();
      }
    } else {
      trip.status = TRIP_STATUS.ACCEPTED;
      trip.assignedAt = null;
    }

    return;
  }

  trip.status = TRIP_STATUS.PLANNED;
};

const ensureTripAssignableByTransporter = (trip, transporterId) => {
  if (trip.bookedBy === 'CUSTOMER') {
    if (!trip.acceptedTransporterId || trip.acceptedTransporterId.toString() !== transporterId) {
      return 'Only the accepted transporter can assign this customer trip.';
    }

    if (![TRIP_STATUS.ACCEPTED, TRIP_STATUS.PLANNED].includes(trip.status)) {
      return `Trip cannot be assigned in current status: ${trip.status}`;
    }

    return null;
  }

  if (trip.transporterId.toString() !== transporterId) {
    return 'Access denied. You do not have permission to assign this trip.';
  }

  if (trip.status !== TRIP_STATUS.PLANNED) {
    return `Trip can only be assigned when status is ${TRIP_STATUS.PLANNED}`;
  }

  return null;
};

const emitAssignmentEvents = async (trip, eventName, notificationMessage) => {
  const payload = buildAssignmentPayload(trip);

  if (eventName === 'trip:vehicle:assigned') {
    emitTripVehicleAssigned(payload.trip, payload.assignment);
  } else if (eventName === 'trip:driver:assigned') {
    emitTripDriverAssigned(payload.trip, payload.assignment);
  }

  if (trip.customerId) {
    await createNotification({
      userId: trip.customerId._id || trip.customerId,
      userType: 'CUSTOMER',
      type: 'TRIP_DRIVER_ASSIGNED',
      title: 'Trip assignment updated',
      message: notificationMessage,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        vehicleId: trip.vehicleId?._id || trip.vehicleId || null,
        hiredVehicle: trip.hiredVehicle || null,
        driverId: trip.driverId?._id || trip.driverId || null,
        status: trip.status,
      },
      priority: 'high',
    });
  }
};

/**
 * Create a new trip
 * POST /api/trips
 */
const createTrip = async (req, res, next) => {
  try {
    // Transporters and company users with createTrips permission can create trips
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can create trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to create trips.',
      });
    }
    const { vehicleId, hiredVehicle, driverId, containerNumber, reference, pickupLocation, dropLocation, tripType } = req.body;

    // Validate required fields
    if (!tripType || !['IMPORT', 'EXPORT'].includes(tripType)) {
      return res.status(400).json({
        success: false,
        message: 'Trip type is required and must be IMPORT or EXPORT',
      });
    }

    const vehicleAssignmentError = validateVehicleAssignmentInput({ vehicleId, hiredVehicle });
    if (vehicleAssignmentError) {
      return res.status(400).json({
        success: false,
        message: vehicleAssignmentError,
      });
    }

    let normalizedHiredVehicle = null;

    // Validate vehicle if provided
    if (vehicleId) {
      const vehicleValidation = await validateOwnedVehicleAccess(vehicleId, transporterId);
      if (vehicleValidation.error) {
        return res.status(vehicleValidation.statusCode).json({
          success: false,
          message: vehicleValidation.error,
        });
      }
    } else if (hiredVehicle) {
      normalizedHiredVehicle = normalizeHiredVehicle(hiredVehicle);
    }

    // Validate driver if provided
    if (driverId) {
      const driver = await Driver.findById(driverId);
      if (!driver) {
        return res.status(404).json({
          success: false,
          message: 'Driver not found',
        });
      }

      if (driver.transporterId?.toString() !== transporterId) {
        return res.status(403).json({
          success: false,
          message: 'Driver does not belong to your transporter account',
        });
      }
    }

    // Validate locations if provided
    if (pickupLocation && (!pickupLocation.coordinates?.latitude || !pickupLocation.coordinates?.longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Pickup location must include coordinates (latitude and longitude)',
      });
    }

    if (dropLocation && (!dropLocation.coordinates?.latitude || !dropLocation.coordinates?.longitude)) {
      return res.status(400).json({
        success: false,
        message: 'Drop location must include coordinates (latitude and longitude)',
      });
    }

    const photoRules = await getDefaultPhotoRules();

    // Create trip
    const trip = new Trip({
      transporterId,
      vehicleId: vehicleId || null,
      hiredVehicle: normalizedHiredVehicle,
      driverId: driverId || null,
      containerNumber: containerNumber?.trim().toUpperCase() || null,
      reference: reference?.trim() || null,
      pickupLocation: normalizeLocation(pickupLocation),
      dropLocation: normalizeLocation(dropLocation),
      tripType,
      status: TRIP_STATUS.PLANNED,
      customerOwnership: {
        ownerType: 'TRANSPORTER_MANAGED',
        payerType: 'TRANSPORTER',
      },
      visibilityMode: 'FULL_EXECUTION',
      photoRules,
      audit: {
        createdBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType),
        },
        updatedBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType),
        },
      },
    });

    if ((vehicleId || normalizedHiredVehicle) && driverId) {
      trip.assignedAt = new Date();
    }

    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    // Emit Socket.IO event
    emitTripCreated(transporterId, trip);

    res.status(201).json({
      success: true,
      message: 'Trip created successfully',
      data: serializeTrip(trip, { includeCurrentMilestone: true }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all trips for authenticated transporter
 * GET /api/trips
 */
const getTrips = async (req, res, next) => {
  try {
    // Admins can see all trips, transporters and company users can see their own
    const transporterId = getTransporterId(req.user);
    const isAdmin = req.user.userType === 'admin';

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, authorized company users, or admins can view trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.',
      });
    }
    const { status, vehicleId, driverId, tripType, transporterId: queryTransporterId, page = 1, limit = 20, startDate, endDate } = req.query;

    // Build query - admins can see all, others see only their transporter's trips
    const query = {};
    if (!isAdmin) {
      query.transporterId = transporterId;
    } else if (queryTransporterId) {
      // Admin can filter by transporterId if provided
      query.transporterId = queryTransporterId;
    }

    if (status) {
      query.status = status;
    }
    if (vehicleId) {
      query.vehicleId = vehicleId;
    }
    if (driverId) {
      query.driverId = driverId;
    }
    if (tripType) {
      query.tripType = tripType;
    }
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    // Get trips with pagination
    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trip.countDocuments(query);

    res.json({
      success: true,
      data: serializeTrips(trips),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get trip by ID
 * GET /api/trips/:id
 */
const getTripById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transporterId = getTransporterId(req.user);

    // Find trip
    const trip = await Trip.findById(id)
      .populate('vehicleId', 'vehicleNumber trailerType status')
      .populate('driverId', 'name mobile status')
      .populate('transporterId', 'name company')
      .populate('customerId', 'name mobile email isRegistered')
      .populate('acceptedTransporterId', 'name company mobile');

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access - admins can see all trips
    const isAdmin = req.user.userType === 'admin';

    if (!isAdmin) {
      if (transporterId) {
        // Check permission for company users
        if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have permission to view trips.',
          });
        }

        if (trip.transporterId._id.toString() !== transporterId) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have permission to view this trip.',
          });
        }
      } else if (req.user?.userType === 'customer') {
        if (!trip.customerId || trip.customerId._id.toString() !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have permission to view this trip.',
          });
        }
      } else if (req.user?.userType === 'driver') {
        if (!trip.driverId || trip.driverId._id.toString() !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have permission to view this trip.',
          });
        }
      } else if (req.user && req.user.userType !== 'driver') {
        // Drivers can view their own trips, but others need transporter access
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.',
        });
      }
    }

    const data =
      req.user?.userType === 'customer'
        ? getTripVisibilityResponse(trip, {
            actor: req.user,
            accessType: 'direct',
            includeCurrentMilestone: true,
          })
        : serializeTrip(trip, { includeCurrentMilestone: true });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update trip
 * PUT /api/trips/:id
 */
const updateTrip = async (req, res, next) => {
  try {
    // Transporters and company users with createTrips permission can update trips
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can update trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update trips.',
      });
    }

    const { id } = req.params;
    const { vehicleId, hiredVehicle, driverId, containerNumber, reference, pickupLocation, dropLocation } = req.body;

    // Find trip
    const trip = await Trip.findById(id);
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
        message: 'Access denied. You do not have permission to update this trip.',
      });
    }

    // Only allow updates if trip is PLANNED
    if (trip.status !== TRIP_STATUS.PLANNED) {
      return res.status(400).json({
        success: false,
        message: 'Trip can only be updated when status is PLANNED',
      });
    }

    const vehicleAssignmentProvided = vehicleId !== undefined || hiredVehicle !== undefined;
    if (vehicleAssignmentProvided) {
      const vehicleAssignmentError = validateVehicleAssignmentInput({
        vehicleId: vehicleId === null ? null : vehicleId,
        hiredVehicle,
      });

      if (vehicleAssignmentError) {
        return res.status(400).json({
          success: false,
          message: vehicleAssignmentError,
        });
      }
    }

    // Validate vehicle if provided
    if (vehicleId !== undefined) {
      if (vehicleId === null) {
        trip.vehicleId = null;
      } else {
        const vehicleValidation = await validateOwnedVehicleAccess(vehicleId, transporterId);
        if (vehicleValidation.error) {
          return res.status(vehicleValidation.statusCode).json({
            success: false,
            message: vehicleValidation.error,
          });
        }

        trip.vehicleId = vehicleId;
      }
      trip.hiredVehicle = null;
    } else if (hiredVehicle !== undefined) {
      trip.vehicleId = null;
      trip.hiredVehicle = hiredVehicle ? normalizeHiredVehicle(hiredVehicle) : null;
    }

    // Validate driver if provided
    if (driverId !== undefined) {
      if (driverId === null) {
        trip.driverId = null;
      } else {
        const driver = await Driver.findById(driverId);
        if (!driver) {
          return res.status(404).json({
            success: false,
            message: 'Driver not found',
          });
        }

        if (driver.transporterId?.toString() !== transporterId) {
          return res.status(403).json({
            success: false,
            message: 'Driver does not belong to your transporter account',
          });
        }

        trip.driverId = driverId;
      }
    }

    // Update other fields
    if (containerNumber !== undefined) {
      trip.containerNumber = containerNumber?.trim().toUpperCase() || null;
    }
    if (reference !== undefined) {
      trip.reference = reference?.trim() || null;
    }
    if (pickupLocation !== undefined) {
      if (pickupLocation && (!pickupLocation.coordinates?.latitude || !pickupLocation.coordinates?.longitude)) {
        return res.status(400).json({
          success: false,
          message: 'Pickup location must include coordinates (latitude and longitude)',
        });
      }
      trip.pickupLocation = normalizeLocation(pickupLocation);
    }
    if (dropLocation !== undefined) {
      if (dropLocation && (!dropLocation.coordinates?.latitude || !dropLocation.coordinates?.longitude)) {
        return res.status(400).json({
          success: false,
          message: 'Drop location must include coordinates (latitude and longitude)',
        });
      }
      trip.dropLocation = normalizeLocation(dropLocation);
    }

    setAuditActor(trip, req.user);
    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    res.json({
      success: true,
      message: 'Trip updated successfully',
      data: serializeTrip(trip, { includeCurrentMilestone: true }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel trip
 * PUT /api/trips/:id/cancel
 */
const cancelTrip = async (req, res, next) => {
  try {
    // Admins can cancel any trip, transporters and company users can cancel their own
    const transporterId = getTransporterId(req.user);
    const isAdmin = req.user.userType === 'admin';

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, authorized company users, or admins can cancel trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to cancel trips.',
      });
    }

    const { id } = req.params;
    const { reason } = req.body;

    // Find trip
    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access - admins can cancel any trip
    if (!isAdmin && trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to cancel this trip.',
      });
    }

    // Only allow cancellation if trip is PLANNED or ACTIVE (admins can cancel ACTIVE trips)
    if (trip.status !== TRIP_STATUS.PLANNED && trip.status !== TRIP_STATUS.ACTIVE) {
      return res.status(400).json({
        success: false,
        message: 'Trip can only be cancelled when status is PLANNED or ACTIVE',
      });
    }
    
    // Non-admins can only cancel PLANNED trips
    if (!isAdmin && trip.status !== TRIP_STATUS.PLANNED) {
      return res.status(400).json({
        success: false,
        message: 'Only PLANNED trips can be cancelled',
      });
    }

    trip.status = TRIP_STATUS.CANCELLED;
    trip.closedReason = reason?.trim() || 'CANCELLED_BY_USER';
    trip.closedAt = new Date();
    setAuditActor(trip, req.user);
    await trip.save();

    res.json({
      success: true,
      message: 'Trip cancelled successfully',
      data: serializeTrip(trip, { includeCurrentMilestone: true }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search trips
 * GET /api/trips/search
 */
const searchTrips = async (req, res, next) => {
  try {
    // Admins can search all trips, transporters and company users can search their own
    const transporterId = getTransporterId(req.user);
    const isAdmin = req.user.userType === 'admin';

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, authorized company users, or admins can search trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to search trips.',
      });
    }
    const { q, containerNumber, reference, page = 1, limit = 20 } = req.query;

    // Support both 'q' (for containerNumber or reference) and individual params
    const searchQuery = q || containerNumber || reference;
    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        message: 'Please provide q (containerNumber or reference) to search',
      });
    }

    // Build query - admins can search all trips
    const query = {};
    if (!isAdmin) {
      query.transporterId = transporterId;
    }
    
    // Build search criteria - support both 'q' and individual params
    const searchTerm = (q || containerNumber || reference).trim();
    query.$or = [
      { containerNumber: { $regex: searchTerm.toUpperCase(), $options: 'i' } },
      { reference: { $regex: searchTerm, $options: 'i' } },
    ];

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trip.countDocuments(query);

    res.json({
      success: true,
      data: serializeTrips(trips),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get active trips for transporter
 * GET /api/trips/active
 */
const getActiveTrips = async (req, res, next) => {
  try {
    // Admins can see all active trips, transporters and company users can see their own
    const transporterId = getTransporterId(req.user);
    const isAdmin = req.user.userType === 'admin';

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, authorized company users, or admins can view trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.',
      });
    }

    const { transporterId: queryTransporterId } = req.query;
    
    // Build query - admins can see all or filter by transporterId
    const query = { status: TRIP_STATUS.ACTIVE };
    if (!isAdmin) {
      query.transporterId = transporterId;
    } else if (queryTransporterId) {
      query.transporterId = queryTransporterId;
    }

    const activeTrips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'Active trips retrieved successfully',
      data: {
        trips: serializeTrips(activeTrips),
        count: activeTrips.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get trips pending POD approval
 * GET /api/trips/pending-pod
 */
const getPendingPODTrips = async (req, res, next) => {
  try {
    // Admins can see all pending POD trips, transporters and company users can see their own
    const transporterId = getTransporterId(req.user);
    const isAdmin = req.user.userType === 'admin';

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, authorized company users, or admins can view trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.',
      });
    }
    const { page = 1, limit = 20 } = req.query;

    // Build query - trips with POD uploaded but not approved
    const query = {
      status: TRIP_STATUS.POD_PENDING,
      'POD.photo': { $exists: true, $ne: null },
      'POD.approvedAt': null,
    };
    
    if (!isAdmin) {
      query.transporterId = transporterId;
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('POD.uploadedBy', 'name mobile')
      .sort({ 'POD.uploadedAt': -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trip.countDocuments(query);

    return res.status(200).json({
      success: true,
      message: 'Pending POD trips retrieved successfully',
      data: {
        trips: serializeTrips(trips),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get trips by status
 * GET /api/trips/status/:status
 */
const getTripsByStatus = async (req, res, next) => {
  try {
    // Admins can see all trips by status, transporters and company users can see their own
    const transporterId = getTransporterId(req.user);
    const isAdmin = req.user.userType === 'admin';

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, authorized company users, or admins can view trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.',
      });
    }
    const { status } = req.params;
    const { page = 1, limit = 20, transporterId: queryTransporterId } = req.query;

    // Validate status
    const validStatuses = TRIP_STATUS_VALUES;
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    // Build query - admins can see all or filter by transporterId
    const query = { status };
    if (!isAdmin) {
      query.transporterId = transporterId;
    } else if (queryTransporterId) {
      query.transporterId = queryTransporterId;
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trip.countDocuments(query);

    res.json({
      success: true,
      data: serializeTrips(trips),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Share trip - Generate shareable link
 * POST /api/trips/:id/share
 */
const shareTrip = async (req, res, next) => {
  try {
    // Transporters and company users with viewTrips permission can share trips
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can share trips.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to share trips.',
      });
    }

    const { id } = req.params;
    const { expiryHours = 168, expiryDays, linkType, visibilityMode } = req.body; // Default 7 days (168 hours)

    // Find trip
    const trip = await Trip.findById(id);
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
        message: 'Access denied. You do not have permission to share this trip.',
      });
    }

    // Generate share token
    const shareToken = require('crypto').randomBytes(32).toString('hex');
    const shareTokenExpiry = new Date();
    
    // Support both expiryHours and expiryDays for backward compatibility
    if (expiryDays !== undefined) {
      shareTokenExpiry.setDate(shareTokenExpiry.getDate() + parseInt(expiryDays));
    } else {
      shareTokenExpiry.setHours(shareTokenExpiry.getHours() + parseInt(expiryHours));
    }

    // Update trip with share token
    trip.shareToken = shareToken;
    trip.shareTokenExpiry = shareTokenExpiry;
    trip.shareConfig = {
      enabled: true,
      linkType: linkType === 'ORIGIN_PICKUP' ? 'ORIGIN_PICKUP' : 'TRIP_VISIBILITY',
      visibilityMode: visibilityMode === 'FULL_EXECUTION' ? 'FULL_EXECUTION' : 'STATUS_ONLY',
      token: shareToken,
      expiresAt: shareTokenExpiry,
      sharedAt: new Date(),
      sharedBy: {
        userId: req.user.id,
        userType: toAuditUserType(req.user.userType),
      },
    };
    setAuditActor(trip, req.user);
    await trip.save();

    // Generate full shareable URL
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const shareLink = `${baseUrl}/api/trips/shared/${shareToken}/view`;

    res.json({
      success: true,
      message: 'Trip share link generated successfully',
      data: {
        shareToken,
        shareLink,
        shareUrl: shareLink, // Alias for consistency
        expiryDate: shareTokenExpiry,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get shared trip by token
 * GET /api/trips/shared/:token
 */
const getSharedTrip = async (req, res, next) => {
  try {
    const { token } = req.params;

    // Find trip by share token
    const trip = await Trip.findOne({
      shareToken: token,
      shareTokenExpiry: { $gt: new Date() }, // Token not expired
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company');

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Shared trip not found or link has expired',
      });
    }

    res.json({
      success: true,
      data: getTripVisibilityResponse(trip, { accessType: 'shared' }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Render shared trip HTML view
 * GET /api/trips/shared/:token/view
 */
const renderSharedTrip = async (req, res, next) => {
  try {
    const { token } = req.params;

    // Find trip by share token
    const trip = await Trip.findOne({
      shareToken: token,
      shareTokenExpiry: { $gt: new Date() }, // Token not expired
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company');

    if (!trip) {
      return res.render('shared-trip', {
        error: {
          title: 'Link Expired or Invalid',
          message: 'This trip sharing link has expired or is invalid. Please request a new link.',
        },
      });
    }

    // Format status label
    const statusLabels = {
      [TRIP_STATUS.BOOKED]: 'Booked',
      [TRIP_STATUS.ACCEPTED]: 'Accepted',
      [TRIP_STATUS.PLANNED]: 'Planned',
      [TRIP_STATUS.ACTIVE]: 'Active',
      [TRIP_STATUS.POD_PENDING]: 'POD Pending',
      [TRIP_STATUS.CLOSED_WITH_POD]: 'Closed With POD',
      [TRIP_STATUS.CLOSED_WITHOUT_POD]: 'Closed Without POD',
      [TRIP_STATUS.CANCELLED]: 'Cancelled',
    };

    // Format date
    const formatDate = (date) => {
      if (!date) return '';
      const d = new Date(date);
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const visibleTrip = getTripVisibilityResponse(trip, { accessType: 'shared' });
    const tripData = {
      ...visibleTrip,
      status: visibleTrip.status.toLowerCase(),
      statusLabel: statusLabels[trip.status] || trip.status,
      createdAt: formatDate(visibleTrip.createdAt),
      scheduledAt: formatDate(visibleTrip.scheduledAt),
      startedAt: formatDate(visibleTrip.startedAt),
      completedAt: formatDate(visibleTrip.completedAt),
      podDueAt: formatDate(visibleTrip.podDueAt),
      vehicleId: visibleTrip.vehicle || null,
      driverId: visibleTrip.driverId || null,
      transporterId: visibleTrip.transporterId || null,
    };

    res.render('shared-trip', {
      trip: tripData,
    });
  } catch (error) {
    console.error('Error rendering shared trip:', error);
    res.render('shared-trip', {
      error: {
        title: 'Error Loading Trip',
        message: 'An error occurred while loading the trip details. Please try again later.',
      },
    });
  }
};

/**
 * Customer books a trip
 * POST /api/trips/customer/book
 */
const bookCustomerTrip = async (req, res, next) => {
  try {
    if (req.user.userType !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only customers can book trips.',
      });
    }

    const { tripType, containerNumber, reference, pickupLocation, dropLocation, scheduledAt, loadType, notes } = req.body;

    if (!tripType || !['IMPORT', 'EXPORT'].includes(tripType)) {
      return res.status(400).json({
        success: false,
        message: 'Trip type is required and must be IMPORT or EXPORT',
      });
    }

    const pickupError = validateCoordinates(pickupLocation, 'Pickup location');
    if (pickupError) {
      return res.status(400).json({ success: false, message: pickupError });
    }

    const dropError = validateCoordinates(dropLocation, 'Drop location');
    if (dropError) {
      return res.status(400).json({ success: false, message: dropError });
    }

    const customer = await Customer.findById(req.user.id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    const photoRules = await getDefaultPhotoRules();

    const trip = await Trip.create({
      customerId: customer._id,
      bookedBy: 'CUSTOMER',
      bookingStatus: BOOKING_STATUS.OPEN,
      status: TRIP_STATUS.BOOKED,
      tripType,
      containerNumber: containerNumber?.trim().toUpperCase() || null,
      reference: reference?.trim() || null,
      pickupLocation: normalizeLocation(pickupLocation),
      dropLocation: normalizeLocation(dropLocation),
      customerName: customer.name || req.body.customerName?.trim() || null,
      customerMobile: customer.mobile,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      loadType: loadType?.trim() || null,
      notes: notes?.trim() || null,
      customerOwnership: {
        ownerType: 'CUSTOMER_MANAGED',
        payerType: 'CUSTOMER',
      },
      visibilityMode: 'FULL_EXECUTION',
      photoRules,
      audit: {
        createdBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType),
        },
        updatedBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType),
        },
      },
    });

    const activeTransporters = await Transporter.find({ status: 'active', hasAccess: true }).select('_id name company mobile');
    const customerTripData = serializeTripForRealtime(trip);

    await Promise.all(
      activeTransporters.map((transporter) =>
        createNotification({
          userId: transporter._id,
          userType: 'TRANSPORTER',
          type: 'TRIP_BOOKED',
          title: 'New customer trip booked',
          message: `A new customer trip ${trip.tripId} is available for acceptance.`,
          data: {
            tripId: trip._id,
            publicTripId: trip.tripId,
            customerName: trip.customerName,
            pickupLocation: trip.pickupLocation,
            dropLocation: trip.dropLocation,
          },
          priority: 'high',
        })
      )
    );

    await Promise.all(
      activeTransporters.map((transporter) =>
        triggerWatiTemplate(
          () =>
            sendBookingRequestReceivedTemplate({
              transporter,
              trip,
            }),
          `booking request received template for transporter ${transporter._id}`
        )
      )
    );

    await trip.populate('customerId', 'name mobile email isRegistered');
    await triggerWatiTemplate(
      () =>
        sendTripCreatedConfirmation({
          customer,
          trip,
        }),
      'trip created confirmation'
    );

    return res.status(201).json({
      success: true,
      message: 'Trip booked successfully',
      data: serializeTrip(trip),
    });
  } catch (error) {
    console.error('bookCustomerTrip failed:', error);
    if (typeof next === 'function') {
      return next(error);
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error',
    });
  }
};

/**
 * Customer gets own trips
 * GET /api/trips/customer/my-trips
 */
const getCustomerTrips = async (req, res, next) => {
  try {
    if (req.user.userType !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only customers can view their trips.',
      });
    }

    const { page = 1, limit = 20, status } = req.query;
    const query = { customerId: req.user.id };

    if (status) {
      query.status = status;
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const trips = await Trip.find(query)
      .populate('acceptedTransporterId', 'name company mobile')
      .populate('transporterId', 'name company mobile')
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trip.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: trips.map((trip) =>
        getTripVisibilityResponse(trip, {
          actor: req.user,
          accessType: 'direct',
        })
      ),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Transporter gets available customer trip requests
 * GET /api/trips/customer/available
 */
const getAvailableCustomerTrips = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can view available customer trips.',
      });
    }

    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.',
      });
    }

    const { page = 1, limit = 20, tripType } = req.query;
    const query = { ...TRANSPORTER_VISIBLE_BOOKING_QUERY };
    query.rejectedTransporterIds = { $ne: transporterId };
    if (tripType) {
      query.tripType = tripType;
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const trips = await Trip.find(query)
      .populate('customerId', 'name mobile email isRegistered')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trip.countDocuments(query);

    return res.status(200).json({
      success: true,
      data: serializeTrips(trips),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Transporter accepts a customer trip
 * PUT /api/trips/:id/accept
 */
const acceptCustomerTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can accept customer trips.',
      });
    }

    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to accept trips.',
      });
    }

    const trip = await Trip.findOneAndUpdate(
      {
        _id: req.params.id,
        ...TRANSPORTER_VISIBLE_BOOKING_QUERY,
        rejectedTransporterIds: { $ne: transporterId },
      },
      {
        $set: {
          acceptedTransporterId: transporterId,
          transporterId,
          acceptedAt: new Date(),
          bookingStatus: BOOKING_STATUS.ACCEPTED,
          status: TRIP_STATUS.ACCEPTED,
          'audit.updatedBy.userId': req.user.id,
          'audit.updatedBy.userType': toAuditUserType(req.user.userType),
          'audit.acceptedBy.userId': req.user.id,
          'audit.acceptedBy.userType': toAuditUserType(req.user.userType),
        },
      },
      { new: true }
    )
      .populate('customerId', 'name mobile email isRegistered')
      .populate('acceptedTransporterId', 'name company mobile');

    if (!trip) {
      return res.status(409).json({
        success: false,
        message: 'Trip has already been accepted or is no longer available.',
      });
    }

    await createNotification({
      userId: trip.customerId._id,
      userType: 'CUSTOMER',
      type: 'TRIP_ACCEPTED',
      title: 'Trip accepted by transporter',
      message: `Your trip ${trip.tripId} has been accepted by a transporter.`,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        transporterId,
      },
      priority: 'high',
    });

    emitBookingAccepted(trip);

    await triggerWatiTemplate(
      () =>
        sendBookingAcceptedTemplate({
          customer: trip.customerId,
          trip,
        }),
      'booking accepted template'
    );

    return res.status(200).json({
      success: true,
      message: 'Customer trip accepted successfully',
      data: serializeTrip(trip),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Transporter rejects a customer trip
 * PUT /api/trips/:id/reject
 */
const rejectCustomerTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can reject customer trips.',
      });
    }

    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to reject trips.',
      });
    }

    const trip = await Trip.findOne({
      _id: req.params.id,
      ...TRANSPORTER_VISIBLE_BOOKING_QUERY,
      rejectedTransporterIds: { $ne: transporterId },
    }).populate('customerId', 'name mobile email isRegistered');

    if (!trip) {
      return res.status(409).json({
        success: false,
        message: 'Trip is no longer available for rejection or was already rejected by you.',
      });
    }

    trip.rejectedTransporterIds.push(transporterId);
    setAuditActor(trip, req.user);
    await trip.save();

    await createNotification({
      userId: trip.customerId._id,
      userType: 'CUSTOMER',
      type: 'TRIP_REJECTED',
      title: 'Booking rejected by transporter',
      message: `Your trip ${trip.tripId} was not accepted by a transporter.`,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        transporterId,
      },
      priority: 'high',
    });

    emitBookingRejected({ trip, transporterId });

    await triggerWatiTemplate(
      () =>
        sendBookingRejectedTemplate({
          customer: trip.customerId,
          trip,
        }),
      'booking rejected template'
    );

    return res.status(200).json({
      success: true,
      message: 'Customer trip rejected successfully',
      data: serializeTrip(trip),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Assign or change a vehicle for a trip.
 * PUT /api/trips/:id/assign-vehicle
 */
const assignTripVehicle = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can assign vehicles.',
      });
    }

    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to assign vehicles.',
      });
    }

    const { vehicleId, hiredVehicle } = req.body;
    if (!vehicleId && !hiredVehicle) {
      return res.status(400).json({
        success: false,
        message: 'Either vehicleId or hiredVehicle is required',
      });
    }

    const vehicleAssignmentError = validateVehicleAssignmentInput({ vehicleId, hiredVehicle });
    if (vehicleAssignmentError) {
      return res.status(400).json({
        success: false,
        message: vehicleAssignmentError,
      });
    }

    const trip = await Trip.findById(req.params.id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    const assignmentError = ensureTripAssignableByTransporter(trip, transporterId);
    if (assignmentError) {
      return res.status(400).json({
        success: false,
        message: assignmentError,
      });
    }

    if (vehicleId) {
      const vehicleValidation = await validateOwnedVehicleAccess(vehicleId, transporterId);
      if (vehicleValidation.error) {
        return res.status(vehicleValidation.statusCode).json({
          success: false,
          message: vehicleValidation.error,
        });
      }
      trip.vehicleId = vehicleId;
      trip.hiredVehicle = null;
    } else {
      trip.vehicleId = null;
      trip.hiredVehicle = normalizeHiredVehicle(hiredVehicle);
    }

    finalizeAssignmentState(trip);
    setAuditActor(trip, req.user);
    await trip.save();
    await populateTripReferences(trip);

    await emitAssignmentEvents(
      trip,
      'trip:vehicle:assigned',
      `Vehicle has been assigned to your trip ${trip.tripId}.`
    );

    return res.status(200).json({
      success: true,
      message: 'Vehicle assigned successfully',
      data: serializeTrip(trip, { includeCurrentMilestone: true }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Assign or change a driver for a trip.
 * PUT /api/trips/:id/assign-driver
 */
const assignTripDriver = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can assign drivers.',
      });
    }

    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to assign drivers.',
      });
    }

    const { driverId } = req.body;
    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'driverId is required',
      });
    }

    const trip = await Trip.findById(req.params.id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    const assignmentError = ensureTripAssignableByTransporter(trip, transporterId);
    if (assignmentError) {
      return res.status(400).json({
        success: false,
        message: assignmentError,
      });
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    if (driver.transporterId?.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Driver does not belong to your transporter account',
      });
    }

    trip.driverId = driverId;
    finalizeAssignmentState(trip);
    setAuditActor(trip, req.user);
    await trip.save();
    await populateTripReferences(trip);

    await emitAssignmentEvents(
      trip,
      'trip:driver:assigned',
      `Driver has been assigned to your trip ${trip.tripId}.`
    );

    return res.status(200).json({
      success: true,
      message: 'Driver assigned successfully',
      data: serializeTrip(trip, { includeCurrentMilestone: true }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Transporter assigns vehicle and driver to accepted trip
 * PUT /api/trips/:id/assign
 */
const assignCustomerTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can assign trips.',
      });
    }

    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'createTrips')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to assign trips.',
      });
    }

    const { vehicleId, hiredVehicle, driverId } = req.body;
    if ((!vehicleId && !hiredVehicle) || !driverId) {
      return res.status(400).json({
        success: false,
        message: 'driverId and either vehicleId or hiredVehicle are required',
      });
    }

    const vehicleAssignmentError = validateVehicleAssignmentInput({ vehicleId, hiredVehicle });
    if (vehicleAssignmentError) {
      return res.status(400).json({
        success: false,
        message: vehicleAssignmentError,
      });
    }

    const trip = await Trip.findById(req.params.id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    if (trip.bookedBy !== 'CUSTOMER') {
      return res.status(400).json({
        success: false,
        message: 'This trip was not booked by a customer.',
      });
    }

    if (!trip.acceptedTransporterId || trip.acceptedTransporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the accepted transporter can assign vehicle and driver.',
      });
    }

    if (![TRIP_STATUS.ACCEPTED, TRIP_STATUS.PLANNED].includes(trip.status)) {
      return res.status(400).json({
        success: false,
        message: `Trip cannot be assigned in current status: ${trip.status}`,
      });
    }

    let normalizedHiredVehicle = null;
    if (vehicleId) {
      const vehicleValidation = await validateOwnedVehicleAccess(vehicleId, transporterId);
      if (vehicleValidation.error) {
        return res.status(vehicleValidation.statusCode).json({
          success: false,
          message: vehicleValidation.error,
        });
      }
    } else {
      normalizedHiredVehicle = normalizeHiredVehicle(hiredVehicle);
    }

    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    if (driver.transporterId?.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Driver does not belong to your transporter account',
      });
    }

    trip.vehicleId = vehicleId || null;
    trip.hiredVehicle = normalizedHiredVehicle;
    trip.driverId = driverId;
    trip.transporterId = transporterId;
    finalizeAssignmentState(trip);
    setAuditActor(trip, req.user);
    await trip.save();

    await populateTripReferences(trip);

    await createNotification({
      userId: trip.customerId._id,
      userType: 'CUSTOMER',
      type: 'TRIP_DRIVER_ASSIGNED',
      title: 'Vehicle and driver assigned',
      message: `Vehicle and driver have been assigned to your trip ${trip.tripId}.`,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        vehicleId: trip.vehicleId?._id,
        hiredVehicle: trip.hiredVehicle || null,
        driverId: trip.driverId?._id,
      },
      priority: 'high',
    });

    emitTripAssigned(trip, buildAssignmentPayload(trip).assignment);

    await triggerWatiTemplate(
      () =>
        sendDriverVehicleAssignedTemplate({
          customer: trip.customerId,
          trip,
        }),
      'driver and vehicle assigned template'
    );

    return res.status(200).json({
      success: true,
      message: 'Vehicle and driver assigned successfully',
      data: serializeTrip(trip, { includeCurrentMilestone: true }),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  bookCustomerTrip,
  getCustomerTrips,
  getAvailableCustomerTrips,
  acceptCustomerTrip,
  rejectCustomerTrip,
  assignTripVehicle,
  assignTripDriver,
  assignCustomerTrip,
  createTrip,
  getTrips,
  getTripById,
  updateTrip,
  cancelTrip,
  searchTrips,
  getTripsByStatus,
  getActiveTrips,
  getPendingPODTrips,
  shareTrip,
  getSharedTrip,
  renderSharedTrip,
};
