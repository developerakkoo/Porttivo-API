const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const { checkVehicleHasActiveTrip } = require('../utils/vehicleValidation');
const { emitTripCreated } = require('../services/socket.service');
const { getTransporterId, hasPermission } = require('../middleware/permission.middleware');

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
    const { vehicleId, driverId, containerNumber, reference, pickupLocation, dropLocation, tripType } = req.body;

    // Validate required fields
    if (!tripType || !['IMPORT', 'EXPORT'].includes(tripType)) {
      return res.status(400).json({
        success: false,
        message: 'Trip type is required and must be IMPORT or EXPORT',
      });
    }

    // Validate vehicle if provided
    if (vehicleId) {
      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) {
        return res.status(404).json({
          success: false,
          message: 'Vehicle not found',
        });
      }

      // Check vehicle access (OWN or in hiredBy array)
      const hasAccess =
        vehicle.transporterId.toString() === transporterId ||
        (vehicle.ownerType === 'HIRED' && vehicle.hiredBy.includes(transporterId));

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this vehicle',
        });
      }

      // Check vehicle status
      if (vehicle.status !== 'active') {
        return res.status(400).json({
          success: false,
          message: 'Vehicle is not active',
        });
      }
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

    // Create trip
    const trip = new Trip({
      transporterId,
      vehicleId,
      driverId: driverId || null,
      containerNumber: containerNumber?.trim().toUpperCase() || null,
      reference: reference?.trim() || null,
      pickupLocation: pickupLocation || null,
      dropLocation: dropLocation || null,
      tripType,
      status: 'PLANNED',
    });

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
      data: trip,
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
      data: trips,
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
      .populate('transporterId', 'name company');

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
      } else if (req.user && req.user.userType !== 'driver') {
        // Drivers can view their own trips, but others need transporter access
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this trip.',
        });
      }
    }

    // Get current milestone info for driver
    const currentMilestone = trip.getCurrentMilestone();

    res.json({
      success: true,
      data: {
        ...trip.toObject(),
        currentMilestone,
      },
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
    const { vehicleId, driverId, containerNumber, reference, pickupLocation, dropLocation } = req.body;

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
    if (trip.status !== 'PLANNED') {
      return res.status(400).json({
        success: false,
        message: 'Trip can only be updated when status is PLANNED',
      });
    }

    // Validate vehicle if provided
    if (vehicleId !== undefined) {
      if (vehicleId === null) {
        trip.vehicleId = null;
      } else {
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
          return res.status(404).json({
            success: false,
            message: 'Vehicle not found',
          });
        }

        const hasAccess =
          vehicle.transporterId.toString() === transporterId ||
          (vehicle.ownerType === 'HIRED' && vehicle.hiredBy.includes(transporterId));

        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: 'You do not have access to this vehicle',
          });
        }

        trip.vehicleId = vehicleId;
      }
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
      trip.pickupLocation = pickupLocation || null;
    }
    if (dropLocation !== undefined) {
      if (dropLocation && (!dropLocation.coordinates?.latitude || !dropLocation.coordinates?.longitude)) {
        return res.status(400).json({
          success: false,
          message: 'Drop location must include coordinates (latitude and longitude)',
        });
      }
      trip.dropLocation = dropLocation || null;
    }

    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    res.json({
      success: true,
      message: 'Trip updated successfully',
      data: trip,
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
    if (trip.status !== 'PLANNED' && trip.status !== 'ACTIVE') {
      return res.status(400).json({
        success: false,
        message: 'Trip can only be cancelled when status is PLANNED or ACTIVE',
      });
    }
    
    // Non-admins can only cancel PLANNED trips
    if (!isAdmin && trip.status !== 'PLANNED') {
      return res.status(400).json({
        success: false,
        message: 'Only PLANNED trips can be cancelled',
      });
    }

    trip.status = 'CANCELLED';
    await trip.save();

    res.json({
      success: true,
      message: 'Trip cancelled successfully',
      data: trip,
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
      data: trips,
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
    const query = { status: 'ACTIVE' };
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
        trips: activeTrips,
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
      status: 'POD_PENDING',
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
        trips,
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
    const validStatuses = ['PLANNED', 'ACTIVE', 'COMPLETED', 'POD_PENDING', 'CANCELLED'];
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
      data: trips,
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
    const { expiryHours = 168, expiryDays } = req.body; // Default 7 days (168 hours)

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
      data: trip,
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
      PLANNED: 'Planned',
      ACTIVE: 'Active',
      COMPLETED: 'Completed',
      POD_PENDING: 'POD Pending',
      CANCELLED: 'Cancelled',
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

    // Prepare trip data for template
    const tripData = {
      tripId: trip.tripId,
      containerNumber: trip.containerNumber,
      reference: trip.reference,
      tripType: trip.tripType,
      status: trip.status.toLowerCase(),
      statusLabel: statusLabels[trip.status] || trip.status,
      createdAt: formatDate(trip.createdAt),
      vehicleId: trip.vehicleId
        ? {
            vehicleNumber: trip.vehicleId.vehicleNumber,
            trailerType: trip.vehicleId.trailerType,
          }
        : null,
      driverId: trip.driverId
        ? {
            name: trip.driverId.name,
            mobile: trip.driverId.mobile,
          }
        : null,
      transporterId: trip.transporterId
        ? {
            name: trip.transporterId.name,
            company: trip.transporterId.company,
          }
        : null,
      pickupLocation: trip.pickupLocation
        ? {
            address: trip.pickupLocation.address || '',
            city: trip.pickupLocation.city || '',
            state: trip.pickupLocation.state || '',
          }
        : null,
      dropLocation: trip.dropLocation
        ? {
            address: trip.dropLocation.address || '',
            city: trip.dropLocation.city || '',
            state: trip.dropLocation.state || '',
          }
        : null,
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

module.exports = {
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
