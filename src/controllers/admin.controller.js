const Admin = require('../models/Admin');
const Transporter = require('../models/Transporter');
const Driver = require('../models/Driver');
const PumpOwner = require('../models/PumpOwner');
const PumpStaff = require('../models/PumpStaff');
const CompanyUser = require('../models/CompanyUser');
const Customer = require('../models/Customer');
const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const FuelTransaction = require('../models/FuelTransaction');
const Settlement = require('../models/Settlement');
const Wallet = require('../models/Wallet');
const SystemConfig = require('../models/SystemConfig');
const AdminAuditLog = require('../models/AdminAuditLog');
const { generateTokens } = require('../services/jwt.service');
const { TRIP_STATUS, CLOSED_TRIP_STATUSES } = require('../utils/tripState');
const { logAdminAction } = require('../services/adminAudit.service');

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
    const activeTrips = await Trip.countDocuments({ ...tripDateFilter, status: TRIP_STATUS.ACTIVE });
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
 * List all transporters (Admin only)
 * GET /api/transporters (when accessed by admin)
 */
const listAllTransporters = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20, search } = req.query;
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

    const [transporters, total] = await Promise.all([
      Transporter.find(query)
        .select('-pin')
        .sort({ createdAt: -1 })
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
 * Get transporter details (Admin only)
 * GET /api/transporters/:id (when accessed by admin)
 */
const getTransporterDetails = async (req, res, next) => {
  try {
    const transporter = await Transporter.findById(req.params.id)
      .select('-pin')
      .populate('vehicles', 'vehicleNumber status')
      .populate('drivers', 'name mobile status');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    // Get additional stats
    const [totalVehicles, totalDrivers, totalTrips] = await Promise.all([
      Vehicle.countDocuments({ transporterId: transporter._id }),
      Driver.countDocuments({ transporterId: transporter._id }),
      Trip.countDocuments({ transporterId: transporter._id }),
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
    const { status, riskLevel, transporterId, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (status) query.status = status;
    if (riskLevel) query.riskLevel = riskLevel;
    if (transporterId) query.transporterId = transporterId;

    const [drivers, total] = await Promise.all([
      Driver.find(query)
        .populate('transporterId', 'name company')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Driver.countDocuments(query),
    ]);

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
      Trip.countDocuments({ driverId: driver._id, status: TRIP_STATUS.ACTIVE }),
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
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (status) query.status = status;

    const [pumpOwners, total] = await Promise.all([
      PumpOwner.find(query)
        .sort({ createdAt: -1 })
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
    const { pumpOwnerId, status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (pumpOwnerId) query.pumpOwnerId = pumpOwnerId;
    if (status) query.status = status;

    const [staff, total] = await Promise.all([
      PumpStaff.find(query)
        .populate('pumpOwnerId', 'name pumpName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      PumpStaff.countDocuments(query),
    ]);

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
    const { transporterId, status, hasAccess, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build query
    const query = {};
    if (transporterId) query.transporterId = transporterId;
    if (status) query.status = status;
    if (hasAccess !== undefined) query.hasAccess = hasAccess === 'true';

    const [users, total] = await Promise.all([
      CompanyUser.find(query)
        .populate('transporterId', 'name company')
        .sort({ createdAt: -1 })
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
  // User management
  listAllTransporters,
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
  getDuplicateCustomers,
  mergeCustomers,
  getMilestoneRules,
  updateMilestoneRules,
  setWithdrawalPause,
  getFraudReviewQueue,
  getSettlementOversight,
  getAuditLogs,
};
