const Transporter = require('../models/Transporter');
const Driver = require('../models/Driver');
const CompanyUser = require('../models/CompanyUser');
const PumpOwner = require('../models/PumpOwner');
const { generateTokens } = require('../services/jwt.service');
const { validateMobile, cleanMobile, validateUserType, validatePin } = require('../utils/validation');

/**
 * Send OTP endpoint (simplified - returns tokens directly)
 * POST /api/auth/send-otp
 */
const sendOTP = async (req, res, next) => {
  try {
    const { mobile, userType } = req.body;

    // Validation
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required',
      });
    }

    if (!userType) {
      return res.status(400).json({
        success: false,
        message: 'User type is required',
      });
    }

    if (!validateUserType(userType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type. Must be "transporter", "driver", or "pump_owner"',
      });
    }

    const cleanedMobile = cleanMobile(mobile);
    if (!validateMobile(cleanedMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format. Must be 10 digits',
      });
    }

    const normalizedUserType = userType.toLowerCase();

    try {
      if (normalizedUserType === 'transporter') {
        // Find transporter
        let transporter = await Transporter.findOne({ mobile: cleanedMobile });

        if (!transporter) {
          return res.status(404).json({
            success: false,
            message: 'Transporter not registered. Please contact admin for registration.',
          });
        }

        // Check if transporter is blocked
        if (transporter.status === 'blocked') {
          return res.status(403).json({
            success: false,
            message: 'Your account has been blocked. Please contact support.',
          });
        }

        // Generate tokens
        const tokens = generateTokens({
          id: transporter._id,
          mobile: transporter.mobile,
          userType: 'transporter',
        });

        // Return success response
        return res.status(200).json({
          success: true,
          message: 'Login successful',
          data: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: {
              id: transporter._id,
              mobile: transporter.mobile,
              name: transporter.name,
              email: transporter.email,
              company: transporter.company,
              userType: 'transporter',
              status: transporter.status,
              hasAccess: transporter.hasAccess,
              hasPinSet: transporter.hasPinSet(),
            },
          },
        });
      } else if (normalizedUserType === 'driver') {
        // Find or create driver
        let driver = await Driver.findOne({ mobile: cleanedMobile });

        if (!driver) {
          // Auto-create driver with pending status
          driver = await Driver.create({
            mobile: cleanedMobile,
            name: '', // Will be updated later
            status: 'pending',
            riskLevel: 'low',
            language: 'en',
            walletBalance: 0,
          });
        }

        // Check if driver is blocked
        if (driver.status === 'blocked') {
          return res.status(403).json({
            success: false,
            message: 'Your account has been blocked. Please contact support.',
          });
        }

        // Generate tokens
        const tokens = generateTokens({
          id: driver._id,
          mobile: driver.mobile,
          userType: 'driver',
        });

        // Determine hasAccess based on status
        const hasAccess = driver.status === 'active';

        // Return success response
        return res.status(200).json({
          success: true,
          message: 'Login successful',
          data: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: {
              id: driver._id,
              mobile: driver.mobile,
              name: driver.name,
              userType: 'driver',
              status: driver.status,
              hasAccess: hasAccess,
              language: driver.language,
              transporterId: driver.transporterId,
            },
          },
        });
      } else if (normalizedUserType === 'pump_owner') {
        // Find pump owner
        let pumpOwner = await PumpOwner.findOne({ mobile: cleanedMobile });

        if (!pumpOwner) {
          return res.status(404).json({
            success: false,
            message: 'Pump owner not registered. Please contact admin for registration.',
          });
        }

        // Check if pump owner is blocked
        if (pumpOwner.status === 'blocked') {
          return res.status(403).json({
            success: false,
            message: 'Your account has been blocked. Please contact support.',
          });
        }

        // Check if pump owner is inactive or pending
        if (pumpOwner.status === 'inactive' || pumpOwner.status === 'pending') {
          return res.status(403).json({
            success: false,
            message: 'Your account is not active. Please contact admin for activation.',
          });
        }

        // Generate tokens
        const tokens = generateTokens({
          id: pumpOwner._id,
          mobile: pumpOwner.mobile,
          userType: 'pump_owner',
        });

        // Return success response
        return res.status(200).json({
          success: true,
          message: 'Login successful',
          data: {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            user: {
              id: pumpOwner._id,
              mobile: pumpOwner.mobile,
              name: pumpOwner.name,
              email: pumpOwner.email,
              pumpName: pumpOwner.pumpName,
              userType: 'pump_owner',
              status: pumpOwner.status,
              walletBalance: pumpOwner.walletBalance,
              commissionRate: pumpOwner.commissionRate,
            },
          },
        });
      }
    } catch (dbError) {
      console.error('Database error:', dbError);
      return res.status(500).json({
        success: false,
        message: 'Database error occurred',
        error: dbError.message,
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Register transporter endpoint
 * POST /api/auth/register
 */
const register = async (req, res, next) => {
  try {
    const { mobile, name, email, company } = req.body;

    // Validation
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required',
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required',
      });
    }

    if (!company) {
      return res.status(400).json({
        success: false,
        message: 'Company name is required',
      });
    }

    const cleanedMobile = cleanMobile(mobile);
    if (!validateMobile(cleanedMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format. Must be 10 digits',
      });
    }

    // Check if transporter already exists
    const existingTransporter = await Transporter.findOne({ mobile: cleanedMobile });
    if (existingTransporter) {
      return res.status(409).json({
        success: false,
        message: 'Transporter with this mobile number already exists',
      });
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
    }

    // Create new transporter
    const transporter = await Transporter.create({
      mobile: cleanedMobile,
      name: name.trim(),
      email: email ? email.trim().toLowerCase() : undefined,
      company: company.trim(),
      status: 'pending',
      hasAccess: false,
      walletBalance: 0,
    });

    // Generate tokens
    const tokens = generateTokens({
      id: transporter._id,
      mobile: transporter.mobile,
      userType: 'transporter',
    });

    // Return success response
    return res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          userType: 'transporter',
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: transporter.hasPinSet(),
        },
      },
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Transporter with this mobile number already exists',
      });
    }
    next(error);
  }
};

/**
 * PIN Login endpoint (Transporter only)
 * POST /api/auth/pin-login
 */
const pinLogin = async (req, res, next) => {
  try {
    const { mobile, pin } = req.body;

    // Validation
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required',
      });
    }

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

    const cleanedMobile = cleanMobile(mobile);
    if (!validateMobile(cleanedMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format. Must be 10 digits',
      });
    }

    // Find transporter with PIN
    const transporter = await Transporter.findOne({ mobile: cleanedMobile }).select('+pin');

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found',
      });
    }

    // Check if PIN is set
    if (!transporter.hasPinSet()) {
      return res.status(400).json({
        success: false,
        message: 'PIN not set. Please set your PIN first.',
      });
    }

    // Check if transporter is blocked
    if (transporter.status === 'blocked') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Please contact support.',
      });
    }

    // Verify PIN
    const isPinValid = await transporter.comparePin(pin);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid PIN',
      });
    }

    // Generate tokens
    const tokens = generateTokens({
      id: transporter._id,
      mobile: transporter.mobile,
      userType: 'transporter',
    });

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: transporter._id,
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          userType: 'transporter',
          status: transporter.status,
          hasAccess: transporter.hasAccess,
          hasPinSet: true,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Company User Login endpoint
 * POST /api/auth/company-user-login
 */
const companyUserLogin = async (req, res, next) => {
  try {
    const { mobile, pin } = req.body;

    // Validation
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required',
      });
    }

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

    const cleanedMobile = cleanMobile(mobile);
    if (!validateMobile(cleanedMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format. Must be 10 digits',
      });
    }

    // Find company user with PIN
    const companyUser = await CompanyUser.findOne({ mobile: cleanedMobile }).select('+pin');

    if (!companyUser) {
      return res.status(404).json({
        success: false,
        message: 'Company user not found',
      });
    }

    // Check if PIN is set
    if (!companyUser.hasPinSet()) {
      return res.status(400).json({
        success: false,
        message: 'PIN not set. Please contact your administrator to set your PIN.',
      });
    }

    // Check if user has access
    if (!companyUser.hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Your account is not activated. Please contact your administrator.',
      });
    }

    // Check if user is blocked or inactive
    if (companyUser.status === 'blocked') {
      return res.status(403).json({
        success: false,
        message: 'Your account has been blocked. Please contact support.',
      });
    }

    if (companyUser.status === 'inactive') {
      return res.status(403).json({
        success: false,
        message: 'Your account is inactive. Please contact your administrator.',
      });
    }

    // Verify PIN
    const isPinValid = await companyUser.comparePin(pin);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid PIN',
      });
    }

    // Generate tokens
    const tokens = generateTokens({
      id: companyUser._id,
      mobile: companyUser.mobile,
      userType: 'company-user',
    });

    // Return success response
    return res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: companyUser._id,
          mobile: companyUser.mobile,
          name: companyUser.name,
          email: companyUser.email,
          userType: 'company-user',
          status: companyUser.status,
          hasAccess: companyUser.hasAccess,
          hasPinSet: true,
          transporterId: companyUser.transporterId,
          permissions: companyUser.permissions || [],
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Register pump owner endpoint
 * POST /api/auth/register-pump-owner
 */
const registerPumpOwner = async (req, res, next) => {
  try {
    const { mobile, name, email, pumpName, location } = req.body;

    // Validation
    if (!mobile) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number is required',
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Name is required',
      });
    }

    if (!pumpName) {
      return res.status(400).json({
        success: false,
        message: 'Pump name is required',
      });
    }

    const cleanedMobile = cleanMobile(mobile);
    if (!validateMobile(cleanedMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number format. Must be 10 digits',
      });
    }

    // Check if pump owner already exists
    const existingPumpOwner = await PumpOwner.findOne({ mobile: cleanedMobile });
    if (existingPumpOwner) {
      return res.status(409).json({
        success: false,
        message: 'Pump owner with this mobile number already exists',
      });
    }

    // Validate email format if provided
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format',
      });
    }

    // Prepare location data if provided
    let locationData = undefined;
    if (location) {
      locationData = {
        address: location.address ? location.address.trim() : undefined,
        coordinates: location.coordinates ? {
          latitude: location.coordinates.latitude,
          longitude: location.coordinates.longitude,
        } : undefined,
        city: location.city ? location.city.trim() : undefined,
        state: location.state ? location.state.trim() : undefined,
        pincode: location.pincode ? location.pincode.trim() : undefined,
      };
    }

    // Create new pump owner with pending status (requires admin approval)
    const pumpOwner = await PumpOwner.create({
      mobile: cleanedMobile,
      name: name.trim(),
      email: email ? email.trim().toLowerCase() : undefined,
      pumpName: pumpName.trim(),
      location: locationData,
      status: 'pending',
      walletBalance: 0,
      commissionRate: 0,
    });

    // Generate tokens
    const tokens = generateTokens({
      id: pumpOwner._id,
      mobile: pumpOwner.mobile,
      userType: 'pump_owner',
    });

    // Return success response
    return res.status(201).json({
      success: true,
      message: 'Pump owner registered successfully',
      data: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: {
          id: pumpOwner._id,
          mobile: pumpOwner.mobile,
          name: pumpOwner.name,
          email: pumpOwner.email,
          pumpName: pumpOwner.pumpName,
          userType: 'pump_owner',
          status: pumpOwner.status,
          walletBalance: pumpOwner.walletBalance,
          commissionRate: pumpOwner.commissionRate,
        },
      },
    });
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Pump owner with this mobile number already exists',
      });
    }
    next(error);
  }
};

/**
 * Refresh token endpoint
 * POST /api/auth/refresh
 */
const refreshToken = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required',
      });
    }

    const { verifyToken, generateAccessToken } = require('../services/jwt.service');

    try {
      // Verify refresh token
      const decoded = verifyToken(refreshToken);

      // Generate new access token
      const newAccessToken = generateAccessToken({
        userId: decoded.userId,
        mobile: decoded.mobile,
        userType: decoded.userType,
      });

      return res.status(200).json({
        success: true,
        message: 'Token refreshed successfully',
        data: {
          accessToken: newAccessToken,
        },
      });
    } catch (tokenError) {
      return res.status(401).json({
        success: false,
        message: tokenError.message || 'Invalid or expired refresh token',
      });
    }
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendOTP,
  register,
  registerPumpOwner,
  pinLogin,
  companyUserLogin,
  refreshToken,
};
