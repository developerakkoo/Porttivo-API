const Driver = require('../models/Driver');
const Transporter = require('../models/Transporter');
const Trip = require('../models/Trip');
const { getTransporterId, hasPermission } = require('../middleware/permission.middleware');

/**
 * Get driver profile
 * GET /api/drivers/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const driver = await Driver.findById(req.user.id).populate('transporterId', 'name company mobile');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        driver: {
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          transporterId: driver.transporterId,
          transporter: driver.transporterId
            ? {
                id: driver.transporterId._id,
                name: driver.transporterId.name,
                company: driver.transporterId.company,
                mobile: driver.transporterId.mobile,
              }
            : null,
          status: driver.status,
          riskLevel: driver.riskLevel,
          language: driver.language,
          walletBalance: driver.walletBalance,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update driver profile
 * PUT /api/drivers/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { name } = req.body;

    // Build update object
    const updateData = {};
    if (name !== undefined) updateData.name = name?.trim();

    // Update driver
    const driver = await Driver.findByIdAndUpdate(
      req.user.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).populate('transporterId', 'name company mobile');

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        driver: {
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          transporterId: driver.transporterId,
          transporter: driver.transporterId
            ? {
                id: driver.transporterId._id,
                name: driver.transporterId.name,
                company: driver.transporterId.company,
                mobile: driver.transporterId.mobile,
              }
            : null,
          status: driver.status,
          riskLevel: driver.riskLevel,
          language: driver.language,
          walletBalance: driver.walletBalance,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update driver language preference
 * PUT /api/drivers/language
 */
const updateLanguage = async (req, res, next) => {
  try {
    const { language } = req.body;

    // Validate language
    const validLanguages = ['en', 'hi', 'mr'];
    if (!language || !validLanguages.includes(language.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid language. Must be one of: en, hi, mr',
      });
    }

    // Update driver language
    const driver = await Driver.findByIdAndUpdate(
      req.user.id,
      { language: language.toLowerCase() },
      {
        new: true,
        runValidators: true,
      }
    );

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Language preference updated successfully',
      data: {
        driver: {
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          language: driver.language,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get drivers by transporter (for transporter to view their drivers)
 * GET /api/drivers/transporter/:transporterId
 */
const getDriversByTransporter = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can access this endpoint
    const userTransporterId = getTransporterId(req.user);
    if (!userTransporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can view drivers.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageDrivers')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view drivers.',
      });
    }

    const { transporterId } = req.params;

    // Verify the transporterId matches the authenticated transporter/company user's transporter
    if (transporterId !== userTransporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own drivers.',
      });
    }

    // Get all drivers for this transporter
    const drivers = await Driver.find({ transporterId: transporterId }).select('-__v');

    return res.status(200).json({
      success: true,
      message: 'Drivers retrieved successfully',
      data: {
        drivers: drivers.map((driver) => ({
          id: driver._id,
          mobile: driver.mobile,
          name: driver.name,
          status: driver.status,
          riskLevel: driver.riskLevel,
          language: driver.language,
          walletBalance: driver.walletBalance,
          createdAt: driver.createdAt,
          updatedAt: driver.updatedAt,
        })),
        count: drivers.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create driver (for transporters)
 * POST /api/drivers
 */
const createDriver = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can create drivers
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can create drivers.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageDrivers')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to create drivers.',
      });
    }

    const { mobile, name, status } = req.body;

    // Validate mobile number
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required',
      });
    }

    const cleanedMobile = mobile.replace(/\D/g, '');
    if (cleanedMobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number must be 10 digits',
      });
    }

    // Check if driver already exists
    const existingDriver = await Driver.findOne({ mobile: cleanedMobile });
    if (existingDriver) {
      return res.status(409).json({
        success: false,
        message: 'Driver with this mobile number already exists',
      });
    }

    // Validate status if provided
    const validStatuses = ['pending', 'active', 'inactive', 'blocked'];
    const driverStatus = status || 'pending';
    if (!validStatuses.includes(driverStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    // Create driver
    const driver = await Driver.create({
      mobile: cleanedMobile,
      name: name?.trim() || '',
      transporterId,
      status: driverStatus,
    });

    return res.status(201).json({
      success: true,
      message: 'Driver created successfully',
      data: { driver },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update driver (for transporters)
 * PUT /api/drivers/:id
 */
const updateDriver = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can update drivers
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can update drivers.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageDrivers')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update drivers.',
      });
    }

    const { id } = req.params;
    const { name, status } = req.body;

    // Find driver
    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    // Check if driver belongs to transporter
    if (driver.transporterId?.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update this driver.',
      });
    }

    // Update fields
    if (name !== undefined) {
      driver.name = name?.trim() || '';
    }

    if (status !== undefined) {
      const validStatuses = ['pending', 'active', 'inactive', 'blocked'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        });
      }
      driver.status = status;
    }

    await driver.save();

    return res.status(200).json({
      success: true,
      message: 'Driver updated successfully',
      data: { driver },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete driver (for transporters)
 * DELETE /api/drivers/:id
 */
const deleteDriver = async (req, res, next) => {
  try {
    // Transporters and company users with manageDrivers permission can delete drivers
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can delete drivers.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageDrivers')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to delete drivers.',
      });
    }

    const { id } = req.params;

    // Find driver
    const driver = await Driver.findById(id);
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    // Check if driver belongs to transporter
    if (driver.transporterId?.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to delete this driver.',
      });
    }

    // Delete driver
    await Driver.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: 'Driver deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get active trip for driver
 * GET /api/drivers/trips/active
 */
const getActiveTrip = async (req, res, next) => {
  try {
    // Only drivers can access this endpoint
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This endpoint is for drivers only.',
      });
    }

    const driverId = req.user.id;

    // Find active trip assigned to driver
    const activeTrip = await Trip.findOne({
      driverId,
      status: 'ACTIVE',
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('transporterId', 'name company')
      .sort({ createdAt: -1 });

    if (!activeTrip) {
      return res.status(200).json({
        success: true,
        message: 'No active trip found',
        data: {
          trip: null,
        },
      });
    }

    // Get current milestone info
    const currentMilestone = activeTrip.getCurrentMilestone();

    return res.status(200).json({
      success: true,
      message: 'Active trip retrieved successfully',
      data: {
        trip: {
          ...activeTrip.toObject(),
          currentMilestone,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get queued trips for driver
 * GET /api/drivers/trips/queued
 */
const getQueuedTrips = async (req, res, next) => {
  try {
    // Only drivers can access this endpoint
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This endpoint is for drivers only.',
      });
    }

    const driverId = req.user.id;

    // Find queued trips assigned to driver
    const queuedTrips = await Trip.find({
      driverId,
      status: 'PLANNED',
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('transporterId', 'name company')
      .sort({ createdAt: 1 }); // Oldest first (FIFO)

    return res.status(200).json({
      success: true,
      message: 'Queued trips retrieved successfully',
      data: {
        trips: queuedTrips,
        count: queuedTrips.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get trip history for driver
 * GET /api/drivers/trips/history
 */
const getTripHistory = async (req, res, next) => {
  try {
    // Only drivers can access this endpoint
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This endpoint is for drivers only.',
      });
    }

    const driverId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;

    // Build query - exclude PLANNED and ACTIVE trips (those are current/queued)
    const query = {
      driverId,
      status: { $in: ['COMPLETED', 'POD_PENDING', 'CANCELLED'] },
    };

    if (status) {
      query.status = status;
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('transporterId', 'name company')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Trip.countDocuments(query);

    return res.status(200).json({
      success: true,
      message: 'Trip history retrieved successfully',
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

module.exports = {
  getProfile,
  updateProfile,
  updateLanguage,
  getDriversByTransporter,
  createDriver,
  updateDriver,
  deleteDriver,
  getActiveTrip,
  getQueuedTrips,
  getTripHistory,
};
