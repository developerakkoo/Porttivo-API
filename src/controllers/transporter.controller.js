const Transporter = require('../models/Transporter');
const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const Driver = require('../models/Driver');
const { validateMobile, cleanMobile, validatePin } = require('../utils/validation');

/**
 * Get transporter profile
 * GET /api/transporters/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const transporter = await Transporter.findById(req.user.id).select('-pin');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        transporter: {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: transporter.hasPinSet(),
          walletBalance: transporter.walletBalance,
          createdAt: transporter.createdAt,
          updatedAt: transporter.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update transporter profile
 * PUT /api/transporters/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { name, email, company } = req.body;

    // Build update object
    const updateData = {};
    if (name !== undefined) updateData.name = name?.trim();
    if (email !== undefined) {
      updateData.email = email?.trim().toLowerCase();
      // Basic email validation
      if (updateData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updateData.email)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid email format',
        });
      }
    }
    if (company !== undefined) updateData.company = company?.trim();

    // Update transporter
    const transporter = await Transporter.findByIdAndUpdate(
      req.user.id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    ).select('-pin');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        transporter: {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: transporter.hasPinSet(),
          walletBalance: transporter.walletBalance,
          createdAt: transporter.createdAt,
          updatedAt: transporter.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Set PIN for transporter
 * PUT /api/transporters/set-pin
 */
const setPin = async (req, res, next) => {
  try {
    const { pin } = req.body;

    // Validation
    if (!pin) {
      return res.status(400).json({
        success: false,
        message: 'PIN is required',
      });
    }

    if (!validatePin(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be 4 digits',
      });
    }

    // Find transporter and update PIN
    const transporter = await Transporter.findById(req.user.id).select('+pin');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    // Set PIN (will be hashed by pre-save hook)
    transporter.pin = pin;
    await transporter.save();

    return res.status(200).json({
      success: true,
      message: 'PIN set successfully',
      data: {
        hasPinSet: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get transporter dashboard stats
 * GET /api/transporters/dashboard
 */
const getDashboard = async (req, res, next) => {
  try {
    const transporterId = req.user.id;

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Parallel queries for dashboard stats
    const [
      totalVehicles,
      activeTripsCount,
      queuedTripsCount,
      pendingPODCount,
      todaysTripsCount,
      totalDrivers,
    ] = await Promise.all([
      Vehicle.countDocuments({
        $or: [
          { transporterId },
          { hiredBy: transporterId },
        ],
        status: 'active',
      }),
      Trip.countDocuments({
        transporterId,
        status: 'ACTIVE',
      }),
      Trip.countDocuments({
        transporterId,
        status: 'PLANNED',
      }),
      Trip.countDocuments({
        transporterId,
        status: 'POD_PENDING',
      }),
      Trip.countDocuments({
        transporterId,
        createdAt: {
          $gte: today,
          $lt: tomorrow,
        },
      }),
      Driver.countDocuments({
        transporterId,
        status: 'active',
      }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Dashboard stats retrieved successfully',
      data: {
        dashboard: {
          totalVehicles,
          totalDrivers,
          activeTripsCount,
          queuedTripsCount,
          pendingPODCount,
          todaysTripsCount,
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
  setPin,
  getDashboard,
};
