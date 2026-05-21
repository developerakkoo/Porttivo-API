const mongoose = require('mongoose');
const Admin = require('../models/Admin');
const Transporter = require('../models/Transporter');
const Driver = require('../models/Driver');
const PumpOwner = require('../models/PumpOwner');
const PumpStaff = require('../models/PumpStaff');
const CompanyUser = require('../models/CompanyUser');
const Customer = require('../models/Customer');
const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability');
const VehicleRouteAssignment = require('../models/VehicleRouteAssignment');
const VehicleBooking = require('../models/VehicleBooking');
const FuelTransaction = require('../models/FuelTransaction');
const Settlement = require('../models/Settlement');
const Wallet = require('../models/Wallet');
const SystemConfig = require('../models/SystemConfig');
const AdminAuditLog = require('../models/AdminAuditLog');
const AuditLog = require('../models/AuditLog');
const SavedLocation = require('../models/SavedLocation');
const { generateTokens } = require('../services/jwt.service');
const { TRIP_STATUS, CLOSED_TRIP_STATUSES } = require('../utils/tripState');
const { releaseTripResources, syncTripResourceBusyState } = require('../utils/tripResourceState');
const { logAdminAction } = require('../services/adminAudit.service');
const {
  emitTripAssigned,
  emitTripVehicleAssigned,
  emitTripDriverAssigned,
  emitTripCancelled,
  emitTripClosedWithoutPOD,
} = require('../services/socket.service');

const ADMIN_LIST_SORT_FIELDS = ['createdAt', 'name', 'mobile'];
const ADMIN_TRIP_SORT_FIELDS = ['createdAt', 'updatedAt', 'scheduledAt', 'status', 'tripType', 'tripId'];

/**
 * Whitelisted sort for admin list endpoints (avoids arbitrary field injection).
 */
const buildAdminListSort = (sortBy, sortOrder) => {
  const field = ADMIN_LIST_SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt';
  const order = String(sortOrder || '').toLowerCase() === 'asc' ? 1 : -1;
  return { [field]: order };
};

const buildAdminTripSort = (sortBy, sortOrder) => {
  const field = ADMIN_TRIP_SORT_FIELDS.includes(sortBy) ? sortBy : 'createdAt';
  const order = String(sortOrder || '').toLowerCase() === 'asc' ? 1 : -1;
  return { [field]: order };
};

const buildRoutePostDestinationFields = (post) => {
  const destination = post.destination || null;
  const destinations = Array.isArray(post.destinations) ? post.destinations : [];
  const destinationsAll = [destination, ...destinations].filter(
    (entry) => entry && String(entry.formattedAddress ?? entry.address ?? '').trim().length > 0
  );

  return {
    destination,
    destinations,
    destinationsAll,
    destinationQuantities: Array.isArray(post.destinationQuantities) ? post.destinationQuantities : [],
  };
};

const mapRouteAssignmentForAdmin = (assignment) => ({
  id: assignment._id,
  vehicleId: assignment.vehicleId?._id || assignment.vehicleId,
  vehicleNumber: assignment.vehicleId?.vehicleNumber || null,
  price: assignment.price === undefined || assignment.price === null ? null : assignment.price,
  servedStopIndexes: Array.isArray(assignment.servedStopIndexes) ? assignment.servedStopIndexes : [],
  transporter: assignment.transporterId
    ? {
        id: assignment.transporterId._id || assignment.transporterId,
        name: assignment.transporterId.name || null,
        mobile: assignment.transporterId.mobile || null,
      }
    : null,
  createdAt: assignment.createdAt,
  updatedAt: assignment.updatedAt,
});

const isFiniteLocationCoordinate = (value) => Number.isFinite(Number(value));

const normalizeSavedLocationInput = (location) => {
  if (!location) {
    return null;
  }

  let longitude = null;
  let latitude = null;

  if (Array.isArray(location.coordinates)) {
    [longitude, latitude] = location.coordinates;
  } else if (location.coordinates) {
    longitude = location.coordinates.longitude;
    latitude = location.coordinates.latitude;
  }

  longitude = isFiniteLocationCoordinate(longitude) ? Number(longitude) : null;
  latitude = isFiniteLocationCoordinate(latitude) ? Number(latitude) : null;

  return {
    type: 'Point',
    coordinates: longitude !== null && latitude !== null ? [longitude, latitude] : [],
    formattedAddress: location.formattedAddress?.trim() || location.address?.trim() || '',
    placeId: location.placeId?.trim() || null,
    addressLine1: location.addressLine1?.trim() || null,
    locality: location.locality?.trim() || location.city?.trim() || null,
    administrativeArea: location.administrativeArea?.trim() || location.state?.trim() || null,
    postalCode: location.postalCode?.trim() || location.pincode?.trim() || null,
    countryCode: location.countryCode?.trim()?.toUpperCase() || null,
    name: location.name?.trim() || null,
    provider: location.provider || null,
    resolvedAt: location.resolvedAt ? new Date(location.resolvedAt) : null,
  };
};

const validateSavedLocationInput = (location) => {
  if (!location) {
    return 'location is required';
  }

  const normalized = normalizeSavedLocationInput(location);

  if (!normalized.formattedAddress) {
    return 'location.formattedAddress is required';
  }

  if (!Array.isArray(normalized.coordinates) || normalized.coordinates.length !== 2) {
    return 'location.coordinates must be [longitude, latitude] or { longitude, latitude }';
  }

  const [longitude, latitude] = normalized.coordinates;

  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return 'location coordinates are out of range';
  }

  return null;
};

const getTripRulesConfig = async () => {
  let config = await SystemConfig.findOne({ key: 'TRIP_RULES' });
  if (!config) {
    config = await SystemConfig.create({ key: 'TRIP_RULES' });
  }

  return config;
};

/**
 * Admin login
 * POST /api/auth/admin-login
 */
const adminLogin = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required',
      });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+password');

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Check if admin is blocked
    if (admin.status === 'blocked' || admin.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked or is inactive',
      });
    }

    // Verify password
    const isPasswordValid = await admin.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials',
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Generate tokens
    const tokens = generateTokens({
      id: admin._id,
      email: admin.email,
      userType: 'admin',
    });

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          userType: 'admin',
          status: admin.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get admin profile
 * GET /api/admins/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const admin = await Admin.findById(req.user.id).select('-password');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          status: admin.status,
          lastLogin: admin.lastLogin,
          createdAt: admin.createdAt,
          updatedAt: admin.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update admin profile
 * PUT /api/admins/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { username, email } = req.body;

    const admin = await Admin.findById(req.user.id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found',
      });
    }

    if (username !== undefined) admin.username = username;
    if (email !== undefined) admin.email = email.toLowerCase();

    await admin.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        admin: {
          id: admin._id,
          username: admin.username,
          email: admin.email,
          role: admin.role,
        },
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Username or email already exists',
      });
    }
    next(error);
  }
};

/**
 * Get dashboard statistics
 * GET /api/admin/dashboard/stats
 */
const getDashboardStats = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    // Get transporter stats
    const totalTransporters = await Transporter.countDocuments();
    const activeTransporters = await Transporter.countDocuments({ status: 'active' });

    // Get driver stats
    const totalDrivers = await Driver.countDocuments();
    const activeDrivers = await Driver.countDocuments({ status: 'active' });

    // Get vehicle stats
    const totalVehicles = await Vehicle.countDocuments();
    const activeVehicles = await Vehicle.countDocuments({ status: 'active' });

    // Get trip stats
    const tripDateFilter = startDate || endDate ? { createdAt: dateFilter.createdAt } : {};
    const totalTrips = await Trip.countDocuments(tripDateFilter);
    const activeTrips = await Trip.countDocuments({ ...tripDateFilter, status: { $in: [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED] } });
    const completedTrips = await Trip.countDocuments({ ...tripDateFilter, status: { $in: CLOSED_TRIP_STATUSES } });
    const pendingPODTrips = await Trip.countDocuments({ ...tripDateFilter, status: TRIP_STATUS.POD_PENDING });

    // Get fuel transaction stats
    const fuelDateFilter = startDate || endDate ? { createdAt: dateFilter.createdAt } : {};
    const totalFuelTransactions = await FuelTransaction.countDocuments(fuelDateFilter);
    
    const fuelTransactions = await FuelTransaction.find(fuelDateFilter).select('amount status');
    const totalFuelValue = fuelTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    
    // Today's fuel value
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const todayTransactions = await FuelTransaction.find({
      createdAt: { $gte: todayStart, $lte: todayEnd },
      status: 'completed'
    }).select('amount');
    const todayFuelValue = todayTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

    // Get pump owner stats
    const totalPumpOwners = await PumpOwner.countDocuments();
    const activePumpOwners = await PumpOwner.countDocuments({ status: 'active' });

    // Get settlement stats
    const pendingSettlements = await Settlement.countDocuments({ status: 'PENDING' });
    const totalSettlements = await Settlement.countDocuments();

    // Get fraud alerts
    const fraudAlerts = await FuelTransaction.countDocuments({ 
      'fraudFlags.duplicateReceipt': true,
      'fraudFlags.resolved': false
    });
    const pendingFraudAlerts = await FuelTransaction.countDocuments({ 
      status: 'flagged',
      'fraudFlags.resolved': false
    });

    // Get expiring documents (within 30 days)
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    const expiringDocuments = await Vehicle.countDocuments({
      $or: [
        { 'documents.rc.expiryDate': { $lte: thirtyDaysFromNow, $gte: new Date() } },
        { 'documents.insurance.expiryDate': { $lte: thirtyDaysFromNow, $gte: new Date() } },
        { 'documents.fitness.expiryDate': { $lte: thirtyDaysFromNow, $gte: new Date() } },
        { 'documents.permit.expiryDate': { $lte: thirtyDaysFromNow, $gte: new Date() } }
      ]
    });

    return res.status(200).json({
      success: true,
      data: {
        dashboard: {
          totalTransporters,
          activeTransporters,
          totalDrivers,
          activeDrivers,
          totalVehicles,
          activeVehicles,
          totalTrips,
          activeTrips,
          completedTrips,
          pendingPODTrips,
          totalFuelTransactions,
          totalFuelValue,
          todayFuelValue,
          totalPumpOwners,
          activePumpOwners,
          pendingSettlements,
          totalSettlements,
          fraudAlerts,
          pendingFraudAlerts,
          expiringDocuments,
          period: {
            startDate: startDate || null,
            endDate: endDate || null,
          },
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get system analytics
 * GET /api/admin/analytics
 */
const getSystemAnalytics = async (req, res, next) => {
  try {
    const { type = 'trips', startDate, endDate, groupBy = 'day' } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    let analytics = { type, groupBy, data: [], summary: {} };

    if (type === 'trips') {
      const trips = await Trip.find(dateFilter).select('status createdAt');
      
      // Group by day/week/month
      const grouped = {};
      trips.forEach(trip => {
        const date = new Date(trip.createdAt);
        let key;
        
        if (groupBy === 'day') {
          key = date.toISOString().split('T')[0];
        } else if (groupBy === 'week') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else if (groupBy === 'month') {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }

        if (!grouped[key]) {
          grouped[key] = { count: 0, completed: 0, active: 0, cancelled: 0 };
        }
        
        grouped[key].count++;
        if (CLOSED_TRIP_STATUSES.includes(trip.status)) grouped[key].completed++;
        if (trip.status === TRIP_STATUS.ACTIVE) grouped[key].active++;
        if (trip.status === TRIP_STATUS.CANCELLED) grouped[key].cancelled++;
      });

      analytics.data = Object.keys(grouped).sort().map(key => ({
        date: key,
        ...grouped[key],
      }));

      analytics.summary = {
        total: trips.length,
        average: trips.length > 0 ? Math.round(trips.length / Object.keys(grouped).length) : 0,
        peak: Math.max(...Object.values(grouped).map(g => g.count), 0),
      };
    } else if (type === 'fuel') {
      const transactions = await FuelTransaction.find(dateFilter).select('amount status createdAt');
      
      const grouped = {};
      transactions.forEach(tx => {
        const date = new Date(tx.createdAt);
        let key;
        
        if (groupBy === 'day') {
          key = date.toISOString().split('T')[0];
        } else if (groupBy === 'week') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else if (groupBy === 'month') {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }

        if (!grouped[key]) {
          grouped[key] = { count: 0, totalAmount: 0, completed: 0 };
        }
        
        grouped[key].count++;
        grouped[key].totalAmount += tx.amount || 0;
        if (tx.status === 'completed') grouped[key].completed++;
      });

      analytics.data = Object.keys(grouped).sort().map(key => ({
        date: key,
        ...grouped[key],
      }));

      const totalAmount = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
      analytics.summary = {
        total: transactions.length,
        totalAmount,
        average: transactions.length > 0 ? totalAmount / transactions.length : 0,
        peak: Math.max(...Object.values(grouped).map(g => g.totalAmount), 0),
      };
    } else if (type === 'users') {
      const transporters = await Transporter.find(dateFilter).select('status createdAt');
      const drivers = await Driver.find(dateFilter).select('status createdAt');
      
      const grouped = {};
      [...transporters, ...drivers].forEach(user => {
        const date = new Date(user.createdAt);
        let key;
        
        if (groupBy === 'day') {
          key = date.toISOString().split('T')[0];
        } else if (groupBy === 'week') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else if (groupBy === 'month') {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }

        if (!grouped[key]) {
          grouped[key] = { transporters: 0, drivers: 0, active: 0 };
        }
        
        if (user.transporterId) {
          grouped[key].drivers++;
        } else {
          grouped[key].transporters++;
        }
        if (user.status === 'active') grouped[key].active++;
      });

      analytics.data = Object.keys(grouped).sort().map(key => ({
        date: key,
        ...grouped[key],
      }));

      analytics.summary = {
        totalTransporters: transporters.length,
        totalDrivers: drivers.length,
        total: transporters.length + drivers.length,
      };
    } else if (type === 'vehicles') {
      const vehicles = await Vehicle.find(dateFilter).select('status createdAt');
      
      const grouped = {};
      vehicles.forEach(vehicle => {
        const date = new Date(vehicle.createdAt);
        let key;
        
        if (groupBy === 'day') {
          key = date.toISOString().split('T')[0];
        } else if (groupBy === 'week') {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
        } else if (groupBy === 'month') {
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }

        if (!grouped[key]) {
          grouped[key] = { count: 0, active: 0 };
        }
        
        grouped[key].count++;
        if (vehicle.status === 'active') grouped[key].active++;
      });

      analytics.data = Object.keys(grouped).sort().map(key => ({
        date: key,
        ...grouped[key],
      }));

      analytics.summary = {
        total: vehicles.length,
        active: vehicles.filter(v => v.status === 'active').length,
      };
    }

    return res.status(200).json({
      success: true,
      data: { analytics },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List trips for admin
 * GET /api/admin/trips
 */
const listAdminTrips = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      tripType,
      transporterId,
      customerId,
      driverId,
      vehicleId,
      q,
      startDate,
      endDate,
      sortBy,
      sortOrder,
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const query = {};

    if (status) query.status = status;
    if (tripType) query.tripType = tripType;
    if (transporterId) query.transporterId = transporterId;
    if (customerId) query.customerId = customerId;
    if (driverId) query.driverId = driverId;
    if (vehicleId) query.vehicleId = vehicleId;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    if (q?.trim()) {
      const search = q.trim();
      query.$or = [
        { tripId: { $regex: search, $options: 'i' } },
        { containerNumber: { $regex: search.toUpperCase(), $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
        { 'pickupLocation.formattedAddress': { $regex: search, $options: 'i' } },
        { 'dropLocation.formattedAddress': { $regex: search, $options: 'i' } },
      ];
    }

    const sort = buildAdminTripSort(sortBy, sortOrder);

    const [trips, total] = await Promise.all([
      Trip.find(query)
        .populate('vehicleId', 'vehicleNumber trailerType status')
        .populate('driverId', 'name mobile status')
        .populate('transporterId', 'name company mobile')
        .populate('customerId', 'name mobile email isRegistered')
        .sort(sort)
        .skip(skip)
        .limit(limitNum),
      Trip.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
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
 * Get trip details for admin
 * GET /api/admin/trips/:id
 */
const getAdminTripDetails = async (req, res, next) => {
  try {
    const trip = await Trip.findById(req.params.id)
      .populate('vehicleId', 'vehicleNumber trailerType status')
      .populate('driverId', 'name mobile status')
      .populate('transporterId', 'name company mobile')
      .populate('customerId', 'name mobile email isRegistered')
      .populate('acceptedTransporterId', 'name company mobile')
      .populate('assignments.vehicleId', 'vehicleNumber trailerType')
      .populate('assignments.driverId', 'name mobile');

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: { trip },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List saved trip locations for admin
 * GET /api/admin/locations
 */
const listSavedLocations = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      q,
      tripId,
      transporterId,
      customerId,
      locationType = 'both',
    } = req.query;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const query = {
      $or: [
        { pickupLocation: { $ne: null } },
        { dropLocation: { $ne: null } },
      ],
    };

    if (tripId) {
      query.tripId = { $regex: tripId.trim(), $options: 'i' };
    }

    if (transporterId) {
      query.transporterId = transporterId;
    }

    if (customerId) {
      query.customerId = customerId;
    }

    if (q?.trim()) {
      const search = q.trim();
      query.$and = [
        {
          $or: [
            { tripId: { $regex: search, $options: 'i' } },
            { containerNumber: { $regex: search.toUpperCase(), $options: 'i' } },
            { reference: { $regex: search, $options: 'i' } },
            { 'pickupLocation.formattedAddress': { $regex: search, $options: 'i' } },
            { 'dropLocation.formattedAddress': { $regex: search, $options: 'i' } },
            { 'pickupLocation.placeId': { $regex: search, $options: 'i' } },
            { 'dropLocation.placeId': { $regex: search, $options: 'i' } },
          ],
        },
      ];
    }

    const [trips, total] = await Promise.all([
      Trip.find(query)
        .populate('transporterId', 'name company mobile')
        .populate('customerId', 'name mobile email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Trip.countDocuments(query),
    ]);

    const locations = trips.map((trip) => {
      const item = {
        tripObjectId: trip._id,
        tripId: trip.tripId,
        containerNumber: trip.containerNumber,
        reference: trip.reference,
        status: trip.status,
        tripType: trip.tripType,
        transporter: trip.transporterId,
        customer: trip.customerId,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
      };

      if (locationType === 'pickup') {
        item.pickupLocation = trip.pickupLocation || null;
      } else if (locationType === 'drop') {
        item.dropLocation = trip.dropLocation || null;
      } else {
        item.pickupLocation = trip.pickupLocation || null;
        item.dropLocation = trip.dropLocation || null;
      }

      return item;
    });

    return res.status(200).json({
      success: true,
      data: {
        locations,
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
 * Create saved location for admin
 * POST /api/admin/locations/saved
 */
const createSavedLocation = async (req, res, next) => {
  try {
    const { label, location, notes, isActive } = req.body;

    if (!label?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'label is required',
      });
    }

    const locationError = validateSavedLocationInput(location);
    if (locationError) {
      return res.status(400).json({
        success: false,
        message: locationError,
      });
    }

    const savedLocation = await SavedLocation.create({
      label: label.trim(),
      location: normalizeSavedLocationInput(location),
      notes: notes?.trim() || null,
      isActive: isActive !== undefined ? Boolean(isActive) : true,
      createdBy: {
        userId: req.user.id,
        userType: 'ADMIN',
      },
      updatedBy: {
        userId: req.user.id,
        userType: 'ADMIN',
      },
    });

    await logAdminAction({
      adminId: req.user.id,
      action: 'SAVED_LOCATION_CREATED',
      entityType: 'SAVED_LOCATION',
      entityId: savedLocation._id,
      metadata: {
        locationId: savedLocation.locationId,
        label: savedLocation.label,
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Saved location created successfully',
      data: {
        savedLocation,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List saved location catalog for admin
 * GET /api/admin/locations/saved
 */
const listSavedLocationCatalog = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, q, isActive } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;
    const query = {};

    if (isActive !== undefined) {
      query.isActive = String(isActive).toLowerCase() === 'true';
    }

    if (q?.trim()) {
      const search = q.trim();
      query.$or = [
        { locationId: { $regex: search, $options: 'i' } },
        { label: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
        { 'location.formattedAddress': { $regex: search, $options: 'i' } },
        { 'location.placeId': { $regex: search, $options: 'i' } },
      ];
    }

    const [savedLocations, total] = await Promise.all([
      SavedLocation.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      SavedLocation.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        savedLocations,
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
 * Get saved location details for admin
 * GET /api/admin/locations/saved/:id
 */
const getSavedLocationDetails = async (req, res, next) => {
  try {
    const savedLocation = await SavedLocation.findById(req.params.id);

    if (!savedLocation) {
      return res.status(404).json({
        success: false,
        message: 'Saved location not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        savedLocation,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all transporters (Admin only)
 * GET /api/transporters (when accessed by admin)
 */
const listAllTransporters = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20, search, sortBy, sortOrder } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
      ];
    }

    const sort = buildAdminListSort(sortBy, sortOrder);

    const [transporters, total] = await Promise.all([
      Transporter.find(query)
        .select('-pin')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Transporter.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        transporters: transporters.map(t => ({
          id: t._id,
          mobile: t.mobile,
          name: t.name,
          email: t.email,
          company: t.company,
          status: t.status,
          hasAccess: t.hasAccess,
          hasPinSet: !!t.pin,
          walletBalance: t.walletBalance,
          createdAt: t.createdAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all transporters with their vehicles grouped underneath
 * GET /api/admin/transporters/with-vehicles
 */
const listTransportersWithVehicles = async (req, res, next) => {
  try {
    const [transporters, vehicles] = await Promise.all([
      Transporter.find({})
        .select('mobile name email company status hasAccess walletBalance createdAt updatedAt pin')
        .sort({ createdAt: -1 })
        .lean(),
      Vehicle.find({})
        .select('vehicleNumber status trailerType vehicleType ownerType transporterId driverId createdAt updatedAt')
        .populate('driverId', 'name mobile status')
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const transporterGroups = new Map(
      transporters.map((transporter) => [
        transporter._id.toString(),
        {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: !!transporter.pin,
          walletBalance: transporter.walletBalance,
          createdAt: transporter.createdAt,
          updatedAt: transporter.updatedAt,
          vehicles: [],
        },
      ])
    );

    vehicles.forEach((vehicle) => {
      const group = transporterGroups.get(vehicle.transporterId?.toString());
      if (!group) return;

      group.vehicles.push({
        id: vehicle._id,
        vehicleNumber: vehicle.vehicleNumber,
        status: vehicle.status,
        ownerType: vehicle.ownerType,
        vehicleType: vehicle.vehicleType,
        trailerType: vehicle.trailerType,
        driver: vehicle.driverId
          ? {
              id: vehicle.driverId._id,
              name: vehicle.driverId.name,
              mobile: vehicle.driverId.mobile,
              status: vehicle.driverId.status,
            }
          : null,
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      });
    });

    const groupedTransporters = transporters.map((transporter) => {
      const group = transporterGroups.get(transporter._id.toString());
      return {
        ...group,
        vehicleCount: group.vehicles.length,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        transporters: groupedTransporters,
        totals: {
          transporters: groupedTransporters.length,
          vehicles: vehicles.length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get transporter route posts with bookings attached
 * GET /api/admin/transporters/:id/route-posts
 */
const getTransporterRoutePosts = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format',
      });
    }

    const transporter = await Transporter.findById(req.params.id)
      .select('mobile name email company status hasAccess walletBalance createdAt updatedAt pin')
      .lean();

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    const routePosts = await VehicleRouteAvailability.find({ transporterId: transporter._id })
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType status isBusy')
      .sort({ createdAt: -1 })
      .lean();

    const postIds = routePosts.map((post) => post._id);
    const [assignments, bookings] = await Promise.all([
      postIds.length
        ? VehicleRouteAssignment.find({
            postId: { $in: postIds },
            isReleased: { $ne: true },
          })
            .populate('vehicleId', 'vehicleNumber vehicleType trailerType status isBusy')
            .populate('transporterId', 'name company mobile status')
            .sort({ createdAt: -1 })
            .lean()
        : Promise.resolve([]),
      postIds.length
        ? VehicleBooking.find({ postId: { $in: postIds } })
            .populate('buyerId', 'name mobile company status')
            .populate('sellerId', 'name mobile company status')
            .populate('vehicleId', 'vehicleNumber vehicleType trailerType status isBusy')
            .populate('tripId', 'tripId status closedAt closedReason')
            .sort({ createdAt: -1 })
            .lean()
        : Promise.resolve([]),
    ]);

    const assignmentsByPost = assignments.reduce((acc, assignment) => {
      const key = assignment.postId?.toString();
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(assignment);
      return acc;
    }, {});

    const bookingsByPost = bookings.reduce((acc, booking) => {
      const key = booking.postId?._id?.toString() || booking.postId?.toString();
      if (!key) return acc;
      if (!acc[key]) acc[key] = [];
      acc[key].push(booking);
      return acc;
    }, {});

    const routePostsWithBookings = routePosts.map((post) => {
      const postKey = post._id.toString();
      const postAssignments = assignmentsByPost[postKey] || [];
      const postBookings = bookingsByPost[postKey] || [];
      const destination = post.destination || null;
      const destinations = Array.isArray(post.destinations) ? post.destinations : [];

      return {
        id: post._id,
        transporter: {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: !!transporter.pin,
          walletBalance: transporter.walletBalance,
        },
        vehicle: post.vehicleId
          ? {
              id: post.vehicleId._id,
              vehicleNumber: post.vehicleId.vehicleNumber,
              vehicleType: post.vehicleId.vehicleType || post.vehicleType,
              trailerType: post.vehicleId.trailerType || null,
              status: post.vehicleId.status,
              isBusy: post.vehicleId.isBusy,
            }
          : null,
        vehicleType: post.vehicleType,
        origin: post.origin,
        destination,
        destinations,
        destinationsAll: [destination, ...destinations].filter(
          (entry) => entry && String(entry.formattedAddress ?? entry.address ?? '').trim().length > 0
        ),
        destinationQuantities: Array.isArray(post.destinationQuantities) ? post.destinationQuantities : [],
        quantity: post.quantity,
        slotsLeft: post.slotsLeft,
        pricePerVehicle: post.pricePerVehicle || null,
        availableFrom: post.availableFrom,
        availableTo: post.availableTo,
        note: post.note,
        status: post.status,
        availableVehicles: postAssignments.map((assignment) => ({
          id: assignment._id,
          vehicleId: assignment.vehicleId?._id || assignment.vehicleId,
          vehicleNumber: assignment.vehicleId?.vehicleNumber || null,
          price: assignment.price === undefined || assignment.price === null ? null : assignment.price,
          servedStopIndexes: Array.isArray(assignment.servedStopIndexes) ? assignment.servedStopIndexes : [],
          transporter: assignment.transporterId
            ? {
                id: assignment.transporterId._id || assignment.transporterId,
                name: assignment.transporterId.name || null,
                mobile: assignment.transporterId.mobile || null,
              }
            : null,
          createdAt: assignment.createdAt,
          updatedAt: assignment.updatedAt,
        })),
        bookings: postBookings.map((booking) => ({
          id: booking._id,
          postId: booking.postId?._id || booking.postId,
          assignmentId: booking.assignmentId,
          vehicle: booking.vehicleId
            ? {
                id: booking.vehicleId._id,
                vehicleNumber: booking.vehicleId.vehicleNumber,
                vehicleType: booking.vehicleId.vehicleType,
                trailerType: booking.vehicleId.trailerType,
                status: booking.vehicleId.status,
                isBusy: booking.vehicleId.isBusy,
              }
            : null,
          buyer: booking.buyerId
            ? {
                id: booking.buyerId._id,
                name: booking.buyerId.name,
                mobile: booking.buyerId.mobile,
                company: booking.buyerId.company,
                status: booking.buyerId.status,
              }
            : null,
          seller: booking.sellerId
            ? {
                id: booking.sellerId._id,
                name: booking.sellerId.name,
                mobile: booking.sellerId.mobile,
                company: booking.sellerId.company,
                status: booking.sellerId.status,
              }
            : null,
          status: booking.status,
          estimatedPrice: booking.estimatedPrice,
          agreedPrice: booking.agreedPrice,
          negotiationRound: booking.negotiationRound,
          lastPriceProposal: booking.lastPriceProposal || null,
          proposalAcknowledgedBy: booking.proposalAcknowledgedBy || null,
          proposalAcknowledgedAt: booking.proposalAcknowledgedAt || null,
          tripId: booking.tripId
            ? {
                id: booking.tripId._id,
                tripId: booking.tripId.tripId,
                status: booking.tripId.status,
                closedAt: booking.tripId.closedAt,
                closedReason: booking.tripId.closedReason,
              }
            : null,
          submittedAt: booking.submittedAt,
          acceptedAt: booking.acceptedAt,
          rejectedAt: booking.rejectedAt,
          confirmedAt: booking.confirmedAt,
          completedAt: booking.completedAt,
          note: booking.note,
          paymentStatus: booking.paymentStatus,
          createdAt: booking.createdAt,
          updatedAt: booking.updatedAt,
        })),
        bookingCount: postBookings.length,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        transporter: {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: !!transporter.pin,
          walletBalance: transporter.walletBalance,
        },
        routePosts: routePostsWithBookings,
        totals: {
          routePosts: routePostsWithBookings.length,
          vehicleAssignments: assignments.length,
          bookings: bookings.length,
          confirmedBookings: bookings.filter((booking) => booking.status === 'CONFIRMED').length,
          completedBookings: bookings.filter((booking) => booking.status === 'COMPLETED').length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get transporter details (Admin only)
 * GET /api/transporters/:id (when accessed by admin)
 */
const getTransporterDetails = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format',
      });
    }

    // Vehicles/drivers are not embedded on Transporter; they reference transporterId.
    const transporter = await Transporter.findById(req.params.id).select('-pin');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    // Stats + related lists (vehicles/drivers use transporterId; they are not embedded on Transporter)
    const [totalVehicles, totalDrivers, totalTrips, vehicles, drivers] = await Promise.all([
      Vehicle.countDocuments({ transporterId: transporter._id }),
      Driver.countDocuments({ transporterId: transporter._id }),
      Trip.countDocuments({ transporterId: transporter._id }),
      Vehicle.find({ transporterId: transporter._id })
        .select('vehicleNumber status trailerType driverId')
        .populate('driverId', 'name mobile')
        .lean(),
      Driver.find({ transporterId: transporter._id }).select('name mobile status').lean(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        transporter: {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: !!transporter.pin,
          walletBalance: transporter.walletBalance,
          totalVehicles,
          totalDrivers,
          totalTrips,
          createdAt: transporter.createdAt,
          vehicles: vehicles.map((v) => ({
            id: v._id,
            vehicleNumber: v.vehicleNumber,
            status: v.status,
            trailerType: v.trailerType,
            driver: v.driverId
              ? {
                  id: v.driverId._id,
                  name: v.driverId.name,
                  mobile: v.driverId.mobile,
                }
              : null,
          })),
          drivers: drivers.map((d) => ({
            id: d._id,
            name: d.name,
            mobile: d.mobile,
            status: d.status,
          })),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update transporter status (Admin only)
 * PUT /api/transporters/:id/status (when accessed by admin)
 */
const updateTransporterStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['active', 'inactive', 'blocked', 'pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (active, inactive, blocked, pending)',
      });
    }

    const transporter = await Transporter.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select('-pin');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Transporter status updated successfully',
      data: {
        transporter: {
          id: transporter._id,
          status: transporter.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all drivers (Admin only)
 * GET /api/drivers (when accessed by admin)
 */
const listAllDrivers = async (req, res, next) => {
  try {
    const { status, riskLevel, transporterId, page = 1, limit = 20, search, sortBy, sortOrder } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (status) query.status = status;
    if (riskLevel) query.riskLevel = riskLevel;
    if (transporterId) query.transporterId = transporterId;
    if (search && String(search).trim()) {
      const s = String(search).trim();
      const rx = { $regex: s, $options: 'i' };
      query.$or = [{ name: rx }, { mobile: rx }];
    }

    const sort = buildAdminListSort(sortBy, sortOrder);

    const [drivers, total] = await Promise.all([
      Driver.find(query)
        .populate('transporterId', 'name company')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      Driver.countDocuments(query),
    ]);

    const driverIds = drivers.map((d) => d._id);
    let tripCountByDriver = new Map();
    if (driverIds.length > 0) {
      const tripCounts = await Trip.aggregate([
        { $match: { driverId: { $in: driverIds } } },
        { $group: { _id: '$driverId', totalTrips: { $sum: 1 } } },
      ]);
      tripCountByDriver = new Map(
        tripCounts.map((t) => [t._id.toString(), t.totalTrips])
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        drivers: drivers.map(d => ({
          id: d._id,
          mobile: d.mobile,
          name: d.name,
          transporterId: d.transporterId?._id || d.transporterId,
          transporter: d.transporterId ? {
            id: d.transporterId._id,
            name: d.transporterId.name,
            company: d.transporterId.company,
          } : null,
          status: d.status,
          riskLevel: d.riskLevel,
          language: d.language,
          walletBalance: d.walletBalance,
          totalTrips: tripCountByDriver.get(d._id.toString()) || 0,
          createdAt: d.createdAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get driver details (Admin only)
 * GET /api/drivers/:id (when accessed by admin)
 */
const getDriverDetails = async (req, res, next) => {
  try {
    const driver = await Driver.findById(req.params.id)
      .populate('transporterId', 'name company');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    // Get additional stats
    const [totalTrips, activeTrips] = await Promise.all([
      Trip.countDocuments({ driverId: driver._id }),
      Trip.countDocuments({ driverId: driver._id, status: { $in: [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED] } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        driver: {
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          transporterId: driver.transporterId?._id || driver.transporterId,
          transporter: driver.transporterId ? {
            id: driver.transporterId._id,
            name: driver.transporterId.name,
            company: driver.transporterId.company,
          } : null,
          status: driver.status,
          riskLevel: driver.riskLevel,
          language: driver.language,
          walletBalance: driver.walletBalance,
          totalTrips,
          activeTrips,
          createdAt: driver.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get driver timeline (Admin only)
 * GET /api/drivers/:id/timeline (when accessed by admin)
 */
const getDriverTimeline = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const driverId = req.params.id;

    // Build date filter
    const dateFilter = { driverId };
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
      if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
    }

    const trips = await Trip.find(dateFilter)
      .select('tripId status createdAt updatedAt completedAt milestones vehicleId')
      .populate('vehicleId', 'vehicleNumber')
      .sort({ createdAt: -1 })
      .limit(50);

    const timeline = [];
    trips.forEach(trip => {
      // Trip started
      if (trip.status === TRIP_STATUS.ACTIVE || trip.completedAt) {
        timeline.push({
          date: trip.createdAt,
          event: 'Trip Started',
          tripId: trip.tripId,
          vehicleNumber: trip.vehicleId?.vehicleNumber || null,
        });
      }

      // Milestones
      if (trip.milestones && trip.milestones.length > 0) {
        trip.milestones.forEach(milestone => {
          timeline.push({
            date: milestone.timestamp,
            event: milestone.backendMeaning || milestone.milestoneType,
            tripId: trip.tripId,
            vehicleNumber: trip.vehicleId?.vehicleNumber || null,
          });
        });
      }

      // Trip completed
      if (CLOSED_TRIP_STATUSES.includes(trip.status) || trip.status === TRIP_STATUS.POD_PENDING) {
        timeline.push({
          date: trip.completedAt || trip.updatedAt,
          event: trip.status === TRIP_STATUS.POD_PENDING ? 'Trip Completed, POD Pending' : 'Trip Closed',
          tripId: trip.tripId,
          vehicleNumber: trip.vehicleId?.vehicleNumber || null,
        });
      }
    });

    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

    return res.status(200).json({
      success: true,
      data: { timeline },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update driver status (Admin only)
 * PUT /api/drivers/:id/status (when accessed by admin)
 */
const updateDriverStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['pending', 'active', 'inactive', 'blocked'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (pending, active, inactive, blocked)',
      });
    }

    const driver = await Driver.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Driver status updated successfully',
      data: {
        driver: {
          id: driver._id,
          status: driver.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all pump owners (Admin only)
 * GET /api/pump-owners (when accessed by admin)
 */
const listAllPumpOwners = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20, search, sortBy, sortOrder } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (status) query.status = status;
    if (search && String(search).trim()) {
      const s = String(search).trim();
      const rx = { $regex: s, $options: 'i' };
      query.$or = [
        { name: rx },
        { mobile: rx },
        { email: rx },
        { pumpName: rx },
      ];
    }

    const sort = buildAdminListSort(sortBy, sortOrder);

    const [pumpOwners, total] = await Promise.all([
      PumpOwner.find(query)
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      PumpOwner.countDocuments(query),
    ]);

    // Get fuel transaction stats for each pump owner
    const pumpOwnersWithStats = await Promise.all(
      pumpOwners.map(async (po) => {
        const fuelTransactions = await FuelTransaction.find({
          pumpOwnerId: po._id,
          status: 'completed',
        }).select('amount');

        const totalFuelValue = fuelTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

        return {
          id: po._id,
          mobile: po.mobile,
          name: po.name,
          email: po.email,
          pumpName: po.pumpName,
          status: po.status,
          walletBalance: po.walletBalance || 0,
          commissionRate: po.commissionRate || 0,
          totalFuelValue,
          createdAt: po.createdAt,
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: {
        pumpOwners: pumpOwnersWithStats,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get pump owner details (Admin only)
 * GET /api/pump-owners/:id (when accessed by admin)
 */
const getPumpOwnerDetails = async (req, res, next) => {
  try {
    const pumpOwner = await PumpOwner.findById(req.params.id);

    if (!pumpOwner) {
      return res.status(404).json({
        success: false,
        message: 'Pump owner not found',
      });
    }

    // Get additional stats
    const [fuelTransactions, uniqueDrivers, uniqueTransporters] = await Promise.all([
      FuelTransaction.find({ pumpOwnerId: pumpOwner._id, status: 'completed' }).select('amount driverId transporterId'),
      FuelTransaction.distinct('driverId', { pumpOwnerId: pumpOwner._id }),
      FuelTransaction.distinct('transporterId', { pumpOwnerId: pumpOwner._id }),
    ]);

    const totalFuelValue = fuelTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);

    return res.status(200).json({
      success: true,
      data: {
        pumpOwner: {
          id: pumpOwner._id,
          mobile: pumpOwner.mobile,
          name: pumpOwner.name,
          email: pumpOwner.email,
          pumpName: pumpOwner.pumpName,
          location: pumpOwner.location,
          status: pumpOwner.status,
          walletBalance: pumpOwner.walletBalance || 0,
          commissionRate: pumpOwner.commissionRate || 0,
          totalDriversVisited: uniqueDrivers.length,
          totalTransporters: uniqueTransporters.length,
          totalFuelValue,
          createdAt: pumpOwner.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update pump owner status (Admin only)
 * PUT /api/pump-owners/:id/status (when accessed by admin)
 */
const updatePumpOwnerStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['active', 'inactive', 'blocked', 'pending'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (active, inactive, blocked, pending)',
      });
    }

    const pumpOwner = await PumpOwner.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!pumpOwner) {
      return res.status(404).json({
        success: false,
        message: 'Pump owner not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Pump owner status updated successfully',
      data: {
        pumpOwner: {
          id: pumpOwner._id,
          status: pumpOwner.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all pump staff (Admin only)
 * GET /api/pump-staff (when accessed by admin)
 */
const listAllPumpStaff = async (req, res, next) => {
  try {
    const { pumpOwnerId, status, page = 1, limit = 20, search, sortBy, sortOrder } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (pumpOwnerId) query.pumpOwnerId = pumpOwnerId;
    if (status) query.status = status;
    if (search && String(search).trim()) {
      const s = String(search).trim();
      const rx = { $regex: s, $options: 'i' };
      query.$or = [{ name: rx }, { mobile: rx }];
    }

    const sort = buildAdminListSort(sortBy, sortOrder);

    const [staff, total] = await Promise.all([
      PumpStaff.find(query)
        .populate('pumpOwnerId', 'name pumpName')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      PumpStaff.countDocuments(query),
    ]);

    const staffIds = staff.map((s) => s._id);
    let txCountByStaff = new Map();
    if (staffIds.length > 0) {
      const txCounts = await FuelTransaction.aggregate([
        { $match: { pumpStaffId: { $in: staffIds }, status: 'completed' } },
        { $group: { _id: '$pumpStaffId', totalTransactions: { $sum: 1 } } },
      ]);
      txCountByStaff = new Map(
        txCounts.map((t) => [t._id.toString(), t.totalTransactions])
      );
    }

    return res.status(200).json({
      success: true,
      data: {
        staff: staff.map(s => ({
          id: s._id,
          mobile: s.mobile,
          name: s.name,
          pumpOwnerId: s.pumpOwnerId?._id || s.pumpOwnerId,
          pumpOwner: s.pumpOwnerId ? {
            id: s.pumpOwnerId._id,
            name: s.pumpOwnerId.name,
            pumpName: s.pumpOwnerId.pumpName,
          } : null,
          status: s.status,
          permissions: s.permissions,
          totalTransactions: txCountByStaff.get(s._id.toString()) || 0,
          createdAt: s.createdAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get pump staff details (Admin only)
 * GET /api/pump-staff/:id (when accessed by admin)
 */
const getPumpStaffDetails = async (req, res, next) => {
  try {
    const staff = await PumpStaff.findById(req.params.id)
      .populate('pumpOwnerId', 'name pumpName');

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Pump staff not found',
      });
    }

    // Get transaction count
    const totalTransactions = await FuelTransaction.countDocuments({
      pumpStaffId: staff._id,
    });

    return res.status(200).json({
      success: true,
      data: {
        staff: {
          id: staff._id,
          mobile: staff.mobile,
          name: staff.name,
          pumpOwnerId: staff.pumpOwnerId?._id || staff.pumpOwnerId,
          pumpOwner: staff.pumpOwnerId ? {
            id: staff.pumpOwnerId._id,
            name: staff.pumpOwnerId.name,
            pumpName: staff.pumpOwnerId.pumpName,
          } : null,
          status: staff.status,
          permissions: staff.permissions,
          totalTransactions,
          createdAt: staff.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all company users (Admin only)
 * GET /api/company-users (when accessed by admin)
 */
const listAllCompanyUsers = async (req, res, next) => {
  try {
    const {
      transporterId,
      status,
      hasAccess,
      page = 1,
      limit = 20,
      search,
      sortBy,
      sortOrder,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (transporterId) query.transporterId = transporterId;
    if (status) query.status = status;
    if (hasAccess !== undefined && hasAccess !== '') {
      query.hasAccess = hasAccess === 'true' || hasAccess === true;
    }
    if (search && String(search).trim()) {
      const s = String(search).trim();
      const rx = { $regex: s, $options: 'i' };
      const searchOr = [
        { name: rx },
        { mobile: rx },
        { email: rx },
      ];
      const transporterMatches = await Transporter.find({
        $or: [
          { company: rx },
          { name: rx },
        ],
      })
        .select('_id')
        .lean();
      const tIds = transporterMatches.map((t) => t._id);
      if (tIds.length) {
        searchOr.push({ transporterId: { $in: tIds } });
      }
      query.$or = searchOr;
    }

    const sort = buildAdminListSort(sortBy, sortOrder);

    const [users, total] = await Promise.all([
      CompanyUser.find(query)
        .populate('transporterId', 'name company')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      CompanyUser.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        users: users.map(u => ({
          id: u._id,
          name: u.name,
          mobile: u.mobile,
          email: u.email,
          transporterId: u.transporterId?._id || u.transporterId,
          transporter: u.transporterId ? {
            id: u.transporterId._id,
            name: u.transporterId.name,
            company: u.transporterId.company,
          } : null,
          hasAccess: u.hasAccess,
          status: u.status,
          permissions: u.permissions,
          hasPinSet: !!u.pin,
          createdAt: u.createdAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get company user details (Admin only)
 * GET /api/company-users/:id (when accessed by admin)
 */
const getCompanyUserDetails = async (req, res, next) => {
  try {
    const user = await CompanyUser.findById(req.params.id)
      .select('-pin')
      .populate('transporterId', 'name company');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Company user not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          mobile: user.mobile,
          email: user.email,
          transporterId: user.transporterId?._id || user.transporterId,
          transporter: user.transporterId ? {
            id: user.transporterId._id,
            name: user.transporterId.name,
            company: user.transporterId.company,
          } : null,
          hasAccess: user.hasAccess,
          status: user.status,
          permissions: user.permissions,
          hasPinSet: !!user.pin,
          createdAt: user.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update company user status (Admin only)
 * PUT /api/admin/company-users/:id/status
 */
const updateCompanyUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['active', 'inactive', 'blocked'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (active, inactive, blocked)',
      });
    }

    const user = await CompanyUser.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select('-pin');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Company user not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Company user status updated successfully',
      data: {
        user: {
          id: user._id,
          status: user.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update pump staff status (Admin only)
 * PUT /api/admin/pump-staff/:id/status
 */
const updatePumpStaffStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!status || !['active', 'inactive', 'blocked', 'disabled'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (active, inactive, blocked, disabled)',
      });
    }

    const staff = await PumpStaff.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Pump staff not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Pump staff status updated successfully',
      data: {
        staff: {
          id: staff._id,
          status: staff.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List all customers (Admin only)
 * GET /api/admin/customers/list
 */
const listAllCustomers = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, search } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const query = {};
    if (status) query.status = status;
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { mobile: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
      ];
    }

    const [customers, total] = await Promise.all([
      Customer.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Customer.countDocuments(query),
    ]);

    const tripCounts = await Promise.all(
      customers.map((c) => Trip.countDocuments({ customerId: c._id }))
    );

    const customersWithCount = customers.map((c, i) => ({
      id: c._id,
      mobile: c.mobile,
      name: c.name,
      email: c.email,
      status: c.status,
      isRegistered: c.isRegistered,
      tripCount: tripCounts[i],
      createdAt: c.createdAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        customers: customersWithCount,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all customers with their trips and activities grouped underneath
 * GET /api/admin/customers/with-trips-activities
 */
const listCustomersWithTripsAndActivities = async (req, res, next) => {
  try {
    const { status, search } = req.query;

    const query = {};
    if (status) query.status = status;
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { mobile: searchRegex },
        { name: searchRegex },
        { email: searchRegex },
      ];
    }

    const customers = await Customer.find(query).sort({ createdAt: -1 }).lean();
    const customerIds = customers.map((customer) => customer._id);

    const [trips, activities] = await Promise.all([
      customerIds.length
        ? Trip.find({ customerId: { $in: customerIds } })
            .select(
              'customerId tripId status bookingStatus tripType containerNumber reference pickupLocation dropLocation customerName customerMobile transporterId vehicleId driverId createdAt updatedAt completedAt closedAt closureStatus audit'
            )
            .populate('transporterId', 'name company mobile status')
            .populate('vehicleId', 'vehicleNumber trailerType vehicleType status')
            .populate('driverId', 'name mobile status')
            .sort({ createdAt: -1 })
            .lean()
        : Promise.resolve([]),
      customerIds.length
        ? AuditLog.find({ userType: 'CUSTOMER', userId: { $in: customerIds } })
            .sort({ createdAt: -1 })
            .lean()
        : Promise.resolve([]),
    ]);

    const groupedCustomers = new Map(
      customers.map((customer) => [
        customer._id.toString(),
        {
          id: customer._id,
          mobile: customer.mobile,
          name: customer.name,
          email: customer.email,
          status: customer.status,
          isRegistered: customer.isRegistered,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
          trips: [],
          activities: [],
        },
      ])
    );

    trips.forEach((trip) => {
      const customerGroup = groupedCustomers.get(trip.customerId?.toString());
      if (!customerGroup) return;

      customerGroup.trips.push({
        id: trip._id,
        tripId: trip.tripId,
        status: trip.status,
        bookingStatus: trip.bookingStatus,
        tripType: trip.tripType,
        closureStatus: trip.closureStatus,
        containerNumber: trip.containerNumber,
        reference: trip.reference,
        customerName: trip.customerName,
        customerMobile: trip.customerMobile,
        pickupLocation: trip.pickupLocation || null,
        dropLocation: trip.dropLocation || null,
        transporter: trip.transporterId
          ? {
              id: trip.transporterId._id,
              name: trip.transporterId.name,
              company: trip.transporterId.company,
              mobile: trip.transporterId.mobile,
              status: trip.transporterId.status,
            }
          : null,
        vehicle: trip.vehicleId
          ? {
              id: trip.vehicleId._id,
              vehicleNumber: trip.vehicleId.vehicleNumber,
              trailerType: trip.vehicleId.trailerType,
              vehicleType: trip.vehicleId.vehicleType,
              status: trip.vehicleId.status,
            }
          : null,
        driver: trip.driverId
          ? {
              id: trip.driverId._id,
              name: trip.driverId.name,
              mobile: trip.driverId.mobile,
              status: trip.driverId.status,
            }
          : null,
        audit: trip.audit
          ? {
              lastStatusChangedAt: trip.audit.lastStatusChangedAt || null,
              statusHistory: Array.isArray(trip.audit.statusHistory) ? trip.audit.statusHistory : [],
              createdBy: trip.audit.createdBy || null,
              updatedBy: trip.audit.updatedBy || null,
              acceptedBy: trip.audit.acceptedBy || null,
            }
          : null,
        completedAt: trip.completedAt,
        closedAt: trip.closedAt,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
      });
    });

    activities.forEach((activity) => {
      const customerGroup = groupedCustomers.get(activity.userId?.toString());
      if (!customerGroup) return;

      customerGroup.activities.push({
        id: activity._id,
        action: activity.action,
        resource: activity.resource,
        resourceId: activity.resourceId,
        result: activity.result,
        requestMethod: activity.requestMethod,
        requestPath: activity.requestPath,
        responseStatus: activity.responseStatus,
        errorMessage: activity.errorMessage,
        metadata: activity.metadata || {},
        createdAt: activity.createdAt,
      });
    });

    const customersWithRelations = customers.map((customer) => {
      const group = groupedCustomers.get(customer._id.toString());
      return {
        ...group,
        tripCount: group.trips.length,
        activityCount: group.activities.length,
        latestTripAt: group.trips[0]?.createdAt || null,
        latestActivityAt: group.activities[0]?.createdAt || null,
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        customers: customersWithRelations,
        totals: {
          customers: customersWithRelations.length,
          trips: trips.length,
          activities: activities.length,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get single customer (Admin only)
 * GET /api/admin/customers/:id
 */
const getCustomerDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid ID format',
      });
    }
    const customer = await Customer.findById(id).lean();
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    const tripCount = await Trip.countDocuments({ customerId: customer._id });
    const activeTripCount = await Trip.countDocuments({
      customerId: customer._id,
      status: {
        $in: [
          TRIP_STATUS.BOOKED,
          TRIP_STATUS.ACCEPTED,
          TRIP_STATUS.PLANNED,
          TRIP_STATUS.ACTIVE,
          TRIP_STATUS.POD_PENDING,
        ],
      },
    });

    res.status(200).json({
      success: true,
      data: {
        customer: {
          id: customer._id,
          mobile: customer.mobile,
          name: customer.name,
          email: customer.email,
          status: customer.status,
          isRegistered: customer.isRegistered,
          tripCount,
          activeTripCount,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update customer status (Admin only)
 * PUT /api/admin/customers/:id/status
 */
const updateCustomerStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'blocked'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (active or blocked)',
      });
    }

    const customer = await Customer.findByIdAndUpdate(id, { status }, { new: true });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found',
      });
    }

    await logAdminAction({
      adminId: req.user.id,
      action: status === 'blocked' ? 'CUSTOMER_BLOCKED' : 'CUSTOMER_UNBLOCKED',
      entityType: 'CUSTOMER',
      entityId: customer._id,
      metadata: { status },
    });

    res.status(200).json({
      success: true,
      message: `Customer ${status === 'blocked' ? 'blocked' : 'unblocked'} successfully`,
      data: {
        customer: {
          id: customer._id,
          status: customer.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin force update trip status
 * PUT /api/admin/trips/:id/status
 */
const adminUpdateTripStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || ![TRIP_STATUS.CANCELLED, TRIP_STATUS.CLOSED_WITHOUT_POD].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (CANCELLED or CLOSED_WITHOUT_POD)',
      });
    }

    const trip = await Trip.findById(id)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company mobile')
      .populate('customerId', 'name mobile');

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    const fromStatus = trip.status;
    const previousTripState = trip.toObject({ depopulate: true });

    if (status === TRIP_STATUS.CANCELLED) {
      const canCancel = [TRIP_STATUS.PLANNED, TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED, TRIP_STATUS.ACCEPTED, TRIP_STATUS.POD_PENDING].includes(trip.status);
      if (!canCancel) {
        return res.status(400).json({
          success: false,
          message: `Trip cannot be cancelled from status: ${trip.status}`,
        });
      }
      trip.status = TRIP_STATUS.CANCELLED;
      trip.closedReason = 'CANCELLED_BY_ADMIN';
      trip.closedAt = new Date();
      trip.audit = trip.audit || {};
      trip.audit.updatedBy = { userId: req.user.id, userType: 'ADMIN' };
      await trip.save();
      await releaseTripResources(trip);
      emitTripCancelled(trip);
    } else if (status === TRIP_STATUS.CLOSED_WITHOUT_POD) {
      if (trip.status !== TRIP_STATUS.POD_PENDING) {
        return res.status(400).json({
          success: false,
          message: `Trip can only be force-closed from POD_PENDING. Current: ${trip.status}`,
        });
      }
      trip.status = TRIP_STATUS.CLOSED_WITHOUT_POD;
      trip.closedAt = new Date();
      trip.closedReason = 'CLOSED_BY_ADMIN';
      trip.audit = trip.audit || {};
      trip.audit.updatedBy = { userId: req.user.id, userType: 'ADMIN' };
      await trip.save();
      await releaseTripResources(trip);
      emitTripClosedWithoutPOD(trip);
    }

    await logAdminAction({
      adminId: req.user.id,
      action: 'TRIP_STATUS_FORCED',
      entityType: 'TRIP',
      entityId: trip._id,
      metadata: { fromStatus, toStatus: status },
    });

    res.status(200).json({
      success: true,
      message: 'Trip status updated successfully',
      data: { trip: trip.toObject ? trip.toObject() : trip },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin reassign trip (transporter, driver, vehicle)
 * PUT /api/admin/trips/:id/reassign
 */
const adminReassignTrip = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { transporterId: newTransporterId, driverId: newDriverId, vehicleId: newVehicleId } = req.body;

    if (!newTransporterId && !newDriverId && !newVehicleId) {
      return res.status(400).json({
        success: false,
        message: 'At least one of transporterId, driverId, or vehicleId is required',
      });
    }

    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    if (![TRIP_STATUS.ACCEPTED, TRIP_STATUS.PLANNED].includes(trip.status)) {
      return res.status(400).json({
        success: false,
        message: `Trip can only be reassigned when status is ACCEPTED or PLANNED. Current: ${trip.status}`,
      });
    }

    const previousTripState = trip.toObject({ depopulate: true });

    let targetTransporterId = trip.transporterId?.toString() || trip.acceptedTransporterId?.toString();

    if (newTransporterId) {
      const transporter = await Transporter.findById(newTransporterId);
      if (!transporter) {
        return res.status(404).json({ success: false, message: 'Transporter not found' });
      }
      if (transporter.status !== 'active') {
        return res.status(400).json({ success: false, message: 'Transporter must be active' });
      }
      trip.transporterId = newTransporterId;
      trip.acceptedTransporterId = newTransporterId;
      targetTransporterId = newTransporterId.toString();
      trip.driverId = null;
      trip.vehicleId = null;
      trip.hiredVehicle = null;
      trip.driverAcceptedAt = null;
    }

    if (newVehicleId) {
      const vehicle = await Vehicle.findById(newVehicleId);
      if (!vehicle) {
        return res.status(404).json({ success: false, message: 'Vehicle not found' });
      }
      if (vehicle.transporterId.toString() !== targetTransporterId) {
        return res.status(400).json({ success: false, message: 'Vehicle must belong to the trip transporter' });
      }
      if (vehicle.status !== 'active') {
        return res.status(400).json({ success: false, message: 'Vehicle must be active' });
      }
      trip.vehicleId = newVehicleId;
      trip.hiredVehicle = null;
    }

    if (newDriverId) {
      const driver = await Driver.findById(newDriverId);
      if (!driver) {
        return res.status(404).json({ success: false, message: 'Driver not found' });
      }
      if (driver.transporterId?.toString() !== targetTransporterId) {
        return res.status(400).json({ success: false, message: 'Driver must belong to the trip transporter' });
      }
      if (driver.status !== 'active') {
        return res.status(400).json({ success: false, message: 'Driver must be active' });
      }
      trip.driverId = newDriverId;
      trip.driverAcceptedAt = null;
    }

    trip.bookingStatus = trip.vehicleId && trip.driverId ? 'ASSIGNED' : trip.bookingStatus;
    trip.status = trip.vehicleId && trip.driverId ? TRIP_STATUS.PLANNED : trip.status;
    trip.audit = trip.audit || {};
    trip.audit.updatedBy = { userId: req.user.id, userType: 'ADMIN' };
    await trip.save();
    await syncTripResourceBusyState(previousTripState, trip, { includeAssignments: false });
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company mobile');
    await trip.populate('customerId', 'name mobile');

    if (newVehicleId) {
      emitTripVehicleAssigned(trip, { vehicleId: trip.vehicleId });
    }
    if (newDriverId) {
      emitTripDriverAssigned(trip, { driverId: trip.driverId });
    }
    if (newVehicleId && newDriverId) {
      emitTripAssigned(trip, { vehicleId: trip.vehicleId, driverId: trip.driverId });
    }

    await logAdminAction({
      adminId: req.user.id,
      action: 'TRIP_REASSIGNED',
      entityType: 'TRIP',
      entityId: trip._id,
      metadata: { transporterId: newTransporterId, driverId: newDriverId, vehicleId: newVehicleId },
    });

    res.status(200).json({
      success: true,
      message: 'Trip reassigned successfully',
      data: { trip: trip.toObject ? trip.toObject() : trip },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get customer duplicate candidates
 * GET /api/admin/customers/duplicates
 */
const getDuplicateCustomers = async (req, res, next) => {
  try {
    const duplicates = await Customer.aggregate([
      {
        $addFields: {
          normalizedName: {
            $trim: {
              input: { $toLower: { $ifNull: ['$name', ''] } },
            },
          },
        },
      },
      {
        $match: {
          normalizedName: { $ne: '' },
        },
      },
      {
        $group: {
          _id: '$normalizedName',
          count: { $sum: 1 },
          customers: {
            $push: {
              id: '$_id',
              name: '$name',
              mobile: '$mobile',
              email: '$email',
              status: '$status',
              createdAt: '$createdAt',
            },
          },
        },
      },
      {
        $match: {
          count: { $gt: 1 },
        },
      },
      {
        $sort: {
          count: -1,
          _id: 1,
        },
      },
    ]);

    res.status(200).json({
      success: true,
      data: {
        duplicates,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Merge duplicate customers
 * POST /api/admin/customers/merge
 */
const mergeCustomers = async (req, res, next) => {
  try {
    const { sourceCustomerId, targetCustomerId } = req.body;

    if (!sourceCustomerId || !targetCustomerId || sourceCustomerId === targetCustomerId) {
      return res.status(400).json({
        success: false,
        message: 'Valid sourceCustomerId and targetCustomerId are required',
      });
    }

    const [sourceCustomer, targetCustomer] = await Promise.all([
      Customer.findById(sourceCustomerId),
      Customer.findById(targetCustomerId),
    ]);

    if (!sourceCustomer || !targetCustomer) {
      return res.status(404).json({
        success: false,
        message: 'Source or target customer not found',
      });
    }

    const tripsUpdated = await Trip.updateMany(
      { customerId: sourceCustomer._id },
      {
        $set: {
          customerId: targetCustomer._id,
        },
      }
    );

    if (!targetCustomer.email && sourceCustomer.email) {
      targetCustomer.email = sourceCustomer.email;
    }
    if (!targetCustomer.name && sourceCustomer.name) {
      targetCustomer.name = sourceCustomer.name;
    }
    if (!targetCustomer.isRegistered && sourceCustomer.isRegistered) {
      targetCustomer.isRegistered = true;
    }

    await targetCustomer.save();
    await Customer.findByIdAndDelete(sourceCustomer._id);

    await logAdminAction({
      adminId: req.user.id,
      action: 'CUSTOMER_MERGED',
      entityType: 'CUSTOMER',
      entityId: targetCustomer._id,
      metadata: {
        sourceCustomerId,
        targetCustomerId,
        tripsUpdated: tripsUpdated.modifiedCount || 0,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Customers merged successfully',
      data: {
        targetCustomerId: targetCustomer._id,
        sourceCustomerId,
        tripsUpdated: tripsUpdated.modifiedCount || 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get trip milestone rule settings
 * GET /api/admin/settings/milestone-rules
 */
const getMilestoneRules = async (req, res, next) => {
  try {
    const config = await getTripRulesConfig();

    res.status(200).json({
      success: true,
      data: {
        milestoneRules: config.milestoneRules,
        updatedAt: config.updatedAt,
        updatedBy: config.updatedBy,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update trip milestone rule settings
 * PUT /api/admin/settings/milestone-rules
 */
const updateMilestoneRules = async (req, res, next) => {
  try {
    const config = await getTripRulesConfig();
    config.milestoneRules = {
      ...config.milestoneRules?.toObject?.(),
      ...req.body,
    };
    config.updatedBy = req.user.id;
    await config.save();

    await logAdminAction({
      adminId: req.user.id,
      action: 'MILESTONE_RULES_UPDATED',
      entityType: 'SYSTEM_CONFIG',
      entityId: config._id,
      metadata: {
        milestoneRules: config.milestoneRules,
      },
    });

    res.status(200).json({
      success: true,
      message: 'Milestone rules updated successfully',
      data: {
        milestoneRules: config.milestoneRules,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Pause or resume wallet withdrawals
 * PUT /api/admin/wallets/:userType/:userId/withdrawal
 */
const setWithdrawalPause = async (req, res, next) => {
  try {
    const { userId, userType } = req.params;
    const { paused, reason } = req.body;
    const normalizedUserType = userType.toUpperCase();

    if (!['DRIVER', 'TRANSPORTER', 'PUMP_OWNER'].includes(normalizedUserType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userType',
      });
    }

    let wallet = await Wallet.findOne({ userId, userType: normalizedUserType });
    if (!wallet) {
      wallet = await Wallet.create({
        userId,
        userType: normalizedUserType,
        balance: 0,
        currency: 'INR',
      });
    }

    wallet.withdrawalPaused = Boolean(paused);
    wallet.withdrawalPauseReason = paused ? reason?.trim() || 'Paused by admin' : null;
    wallet.withdrawalPausedAt = paused ? new Date() : null;
    await wallet.save();

    await logAdminAction({
      adminId: req.user.id,
      action: paused ? 'WITHDRAWAL_PAUSED' : 'WITHDRAWAL_RESUMED',
      entityType: 'WALLET',
      entityId: wallet._id,
      metadata: {
        userId,
        userType: normalizedUserType,
        reason: wallet.withdrawalPauseReason,
      },
    });

    res.status(200).json({
      success: true,
      message: paused ? 'Withdrawal paused successfully' : 'Withdrawal resumed successfully',
      data: {
        wallet: {
          id: wallet._id,
          userId: wallet.userId,
          userType: wallet.userType,
          withdrawalPaused: wallet.withdrawalPaused,
          withdrawalPauseReason: wallet.withdrawalPauseReason,
          withdrawalPausedAt: wallet.withdrawalPausedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get fraud review queue
 * GET /api/admin/fraud/review-queue
 */
const getFraudReviewQueue = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const query = {
      $or: [
        { status: 'flagged' },
        { 'fraudFlags.resolved': false, 'fraudFlags.duplicateReceipt': true },
        { 'fraudFlags.resolved': false, 'fraudFlags.gpsMismatch': true },
        { 'fraudFlags.resolved': false, 'fraudFlags.expressUploads': true },
        { 'fraudFlags.resolved': false, 'fraudFlags.unusualPattern': true },
      ],
    };

    const [transactions, total] = await Promise.all([
      FuelTransaction.find(query)
        .populate('driverId', 'name mobile')
        .populate('transporterId', 'name company mobile')
        .populate('pumpOwnerId', 'name pumpName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      FuelTransaction.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        transactions,
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
 * Get settlement oversight summary
 * GET /api/admin/settlements/oversight
 */
const getSettlementOversight = async (req, res, next) => {
  try {
    const [pending, processing, completed, failed] = await Promise.all([
      Settlement.countDocuments({ status: 'PENDING' }),
      Settlement.countDocuments({ status: 'PROCESSING' }),
      Settlement.countDocuments({ status: 'COMPLETED' }),
      Settlement.countDocuments({ status: 'FAILED' }),
    ]);

    const recentSettlements = await Settlement.find({})
      .populate('pumpOwnerId', 'name pumpName mobile')
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json({
      success: true,
      data: {
        summary: {
          pending,
          processing,
          completed,
          failed,
        },
        settlements: recentSettlements,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get system audit logs (all user types)
 * GET /api/admin/system-audit-logs
 */
const getSystemAuditLogs = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 50,
      userType,
      action,
      resource,
      userId,
      startDate,
      endDate,
      result,
    } = req.query;

    const query = {};
    if (userType) query.userType = userType;
    if (action) query.action = action;
    if (resource) query.resource = resource;
    if (userId) query.userId = userId;
    if (result) query.result = result;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        logs,
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
 * Get admin audit logs
 * GET /api/admin/audit-logs
 */
const getAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 50, action, entityType } = req.query;
    const query = {};
    if (action) query.action = action;
    if (entityType) query.entityType = entityType;

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      AdminAuditLog.find(query)
        .populate('adminId', 'username email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      AdminAuditLog.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        logs,
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

module.exports = {
  adminLogin,
  getProfile,
  updateProfile,
  getDashboardStats,
  getSystemAnalytics,
  listAdminTrips,
  getAdminTripDetails,
  listSavedLocations,
  createSavedLocation,
  listSavedLocationCatalog,
  getSavedLocationDetails,
  // User management
  listAllTransporters,
  listTransportersWithVehicles,
  getTransporterRoutePosts,
  getTransporterDetails,
  updateTransporterStatus,
  listAllDrivers,
  getDriverDetails,
  getDriverTimeline,
  updateDriverStatus,
  listAllPumpOwners,
  getPumpOwnerDetails,
  updatePumpOwnerStatus,
  listAllPumpStaff,
  getPumpStaffDetails,
  listAllCompanyUsers,
  getCompanyUserDetails,
  updateCompanyUserStatus,
  updatePumpStaffStatus,
  listCustomersWithTripsAndActivities,
  listAllCustomers,
  getCustomerDetails,
  updateCustomerStatus,
  getDuplicateCustomers,
  mergeCustomers,
  adminUpdateTripStatus,
  adminReassignTrip,
  getMilestoneRules,
  updateMilestoneRules,
  setWithdrawalPause,
  getFraudReviewQueue,
  getSettlementOversight,
  getAuditLogs,
  getSystemAuditLogs,
};
