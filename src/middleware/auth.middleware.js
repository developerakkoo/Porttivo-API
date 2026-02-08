const { verifyToken } = require('../services/jwt.service');
const Transporter = require('../models/Transporter');
const Driver = require('../models/Driver');
const CompanyUser = require('../models/CompanyUser');
const PumpOwner = require('../models/PumpOwner');
const PumpStaff = require('../models/PumpStaff');
const Admin = require('../models/Admin');

/**
 * Authentication middleware to verify JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Authorization header must be in format: Bearer <token>',
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      // Verify token
      const decoded = verifyToken(token);

      // Fetch user based on userType
      let user = null;
      if (decoded.userType === 'transporter') {
        user = await Transporter.findById(decoded.userId);
      } else if (decoded.userType === 'driver') {
        user = await Driver.findById(decoded.userId);
      } else if (decoded.userType === 'company-user') {
        user = await CompanyUser.findById(decoded.userId);
      } else if (decoded.userType === 'pump_owner') {
        user = await PumpOwner.findById(decoded.userId);
      } else if (decoded.userType === 'pump_staff') {
        user = await PumpStaff.findById(decoded.userId);
      } else if (decoded.userType === 'admin') {
        user = await Admin.findById(decoded.userId);
      }

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found',
        });
      }

      // Check if user is blocked
      if (user.status === 'blocked' || user.status === 'disabled') {
        return res.status(403).json({
          success: false,
          message: 'Your account has been blocked',
        });
      }

      // For company users, check hasAccess and status
      if (decoded.userType === 'company-user') {
        if (!user.hasAccess) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. Your account is not activated.',
          });
        }
        if (user.status === 'inactive') {
          return res.status(403).json({
            success: false,
            message: 'Your account is inactive. Please contact your administrator.',
          });
        }
      }

      // Attach user to request
      req.user = {
        id: user._id.toString(),
        mobile: user.mobile || user.email || user.username,
        userType: decoded.userType,
        userData: user,
      };

      // For company users, include transporterId and permissions
      if (decoded.userType === 'company-user') {
        req.user.transporterId = user.transporterId.toString();
        req.user.permissions = user.permissions || [];
      }

      next();
    } catch (tokenError) {
      return res.status(401).json({
        success: false,
        message: tokenError.message || 'Invalid or expired token',
      });
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = verifyToken(token);
        let user = null;
        if (decoded.userType === 'transporter') {
          user = await Transporter.findById(decoded.userId);
        } else if (decoded.userType === 'driver') {
          user = await Driver.findById(decoded.userId);
        } else if (decoded.userType === 'company-user') {
          user = await CompanyUser.findById(decoded.userId);
        } else if (decoded.userType === 'pump_owner') {
          user = await PumpOwner.findById(decoded.userId);
        } else if (decoded.userType === 'pump_staff') {
          user = await PumpStaff.findById(decoded.userId);
        } else if (decoded.userType === 'admin') {
          user = await Admin.findById(decoded.userId);
        }

        if (user && user.status !== 'blocked' && user.status !== 'disabled') {
          req.user = {
            id: user._id.toString(),
            mobile: user.mobile || user.email || user.username,
            userType: decoded.userType,
            userData: user,
          };

          // For company users, include transporterId and permissions
          if (decoded.userType === 'company-user') {
            req.user.transporterId = user.transporterId.toString();
            req.user.permissions = user.permissions || [];
          }
        }
      } catch (error) {
        // Ignore token errors for optional auth
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  authenticate,
  optionalAuth,
};
