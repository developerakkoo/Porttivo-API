const CompanyUser = require('../models/CompanyUser');
const { getTransporterId } = require('../middleware/permission.middleware');

// Create new company user
const createUser = async (req, res, next) => {
  try {
    const { mobile, name, email, permissions, hasAccess, pin } = req.body;
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    // Validate mobile number
    const cleanedMobile = mobile.replace(/\D/g, '');
    if (cleanedMobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number must be 10 digits',
      });
    }

    // Check if user already exists
    const existingUser = await CompanyUser.findOne({ mobile: cleanedMobile });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'User with this mobile number already exists',
      });
    }

    // Validate permissions
    const validPermissions = [
      'viewTrips',
      'createTrips',
      'manageDrivers',
      'manageVehicles',
      'manageWallet',
      'manageFuelCards',
      'manageUsers',
      'viewReports',
    ];
    const userPermissions = permissions || [];
    const invalidPermissions = userPermissions.filter(
      (p) => !validPermissions.includes(p)
    );
    if (invalidPermissions.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid permissions: ${invalidPermissions.join(', ')}`,
      });
    }

    // Create user
    const userData = {
      mobile: cleanedMobile,
      name: name.trim(),
      transporterId,
      createdBy: transporterId,
      hasAccess: hasAccess || false,
      permissions: userPermissions,
    };

    if (email) {
      userData.email = email.trim().toLowerCase();
    }

    if (pin && hasAccess) {
      if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
        return res.status(400).json({
          success: false,
          message: 'PIN must be exactly 4 digits',
        });
      }
      userData.pin = pin;
    }

    const user = await CompanyUser.create(userData);

    // Return user without PIN
    const userObj = user.toObject();
    delete userObj.pin;

    return res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user: userObj },
    });
  } catch (error) {
    next(error);
  }
};

// Get all users for transporter
const getUsers = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const users = await CompanyUser.find({ transporterId })
      .select('-pin')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'Users retrieved successfully',
      data: {
        users,
        count: users.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get user by ID
const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const user = await CompanyUser.findOne({
      _id: id,
      transporterId,
    }).select('-pin');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'User retrieved successfully',
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

// Update user
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const { name, email, permissions, status } = req.body;

    const user = await CompanyUser.findOne({
      _id: id,
      transporterId,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent company users from modifying their own permissions
    if (req.user.userType === 'company-user' && req.user.id === id && permissions) {
      return res.status(403).json({
        success: false,
        message: 'You cannot modify your own permissions. Please contact your administrator.',
      });
    }

    // Only transporters can modify permissions (not company users)
    if (permissions && req.user.userType === 'company-user') {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to modify user permissions.',
      });
    }

    // Validate permissions if provided
    if (permissions) {
      const validPermissions = [
        'viewTrips',
        'createTrips',
        'manageDrivers',
        'manageVehicles',
        'manageWallet',
        'manageFuelCards',
        'manageUsers',
        'viewReports',
      ];
      const invalidPermissions = permissions.filter(
        (p) => !validPermissions.includes(p)
      );
      if (invalidPermissions.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid permissions: ${invalidPermissions.join(', ')}`,
        });
      }
      user.permissions = permissions;
    }

    if (name) {
      user.name = name.trim();
    }

    if (email !== undefined) {
      user.email = email ? email.trim().toLowerCase() : null;
    }

    if (status) {
      if (!['active', 'inactive', 'blocked'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status',
        });
      }
      user.status = status;
    }

    await user.save();

    const userObj = user.toObject();
    delete userObj.pin;

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: { user: userObj },
    });
  } catch (error) {
    next(error);
  }
};

// Delete user
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const user = await CompanyUser.findOne({
      _id: id,
      transporterId,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent company users from deleting themselves
    if (req.user.userType === 'company-user' && req.user.id === id) {
      return res.status(403).json({
        success: false,
        message: 'You cannot delete your own account. Please contact your administrator.',
      });
    }

    await CompanyUser.deleteOne({ _id: id });

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// Set PIN for user
const setPin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pin } = req.body;
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({
        success: false,
        message: 'PIN must be exactly 4 digits',
      });
    }

    const user = await CompanyUser.findOne({
      _id: id,
      transporterId,
    }).select('+pin');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    user.pin = pin; // PIN will be hashed by pre-save hook
    await user.save();

    return res.status(200).json({
      success: true,
      message: 'PIN set successfully',
      data: { hasPinSet: true },
    });
  } catch (error) {
    next(error);
  }
};

// Toggle user access
const toggleAccess = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { hasAccess } = req.body;
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    if (typeof hasAccess !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'hasAccess must be a boolean',
      });
    }

    const user = await CompanyUser.findOne({
      _id: id,
      transporterId,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Prevent company users from toggling their own access
    if (req.user.userType === 'company-user' && req.user.id === id) {
      return res.status(403).json({
        success: false,
        message: 'You cannot modify your own access. Please contact your administrator.',
      });
    }

    user.hasAccess = hasAccess;
    await user.save();

    const userObj = user.toObject();
    delete userObj.pin;

    return res.status(200).json({
      success: true,
      message: `User access ${hasAccess ? 'enabled' : 'disabled'} successfully`,
      data: { user: userObj },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
  setPin,
  toggleAccess,
};
