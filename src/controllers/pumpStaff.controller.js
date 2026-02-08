const PumpStaff = require('../models/PumpStaff');
const PumpOwner = require('../models/PumpOwner');
const { validateMobile, cleanMobile } = require('../utils/validation');

/**
 * List pump staff
 * GET /api/pump-staff
 */
const listStaff = async (req, res, next) => {
  try {
    let pumpOwnerId;

    // For pump owners, automatically use their own ID
    if (req.user.userType === 'pump_owner') {
      pumpOwnerId = req.user.id;
    } else if (req.user.userType === 'admin') {
      // Admins can specify pumpOwnerId in query, or view all if not specified
      pumpOwnerId = req.query.pumpOwnerId;
      if (!pumpOwnerId) {
        // Admin can view all staff if no pumpOwnerId specified
        const staff = await PumpStaff.find().populate('pumpOwnerId', 'name pumpName mobile').sort({ createdAt: -1 });
        return res.status(200).json({
          success: true,
          message: 'Staff list retrieved successfully',
          data: {
            staff: staff.map((s) => ({
              id: s._id,
              mobile: s.mobile,
              name: s.name,
              pumpOwnerId: s.pumpOwnerId,
              status: s.status,
              permissions: s.permissions,
              createdAt: s.createdAt,
              updatedAt: s.updatedAt,
            })),
          },
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only pump owners and admins can view staff.',
      });
    }

    // Verify pump owner exists
    const pumpOwner = await PumpOwner.findById(pumpOwnerId);
    if (!pumpOwner) {
      return res.status(404).json({
        success: false,
        message: 'Pump owner not found',
      });
    }

    // Check authorization - pump owners can only view their own staff
    if (req.user.userType === 'pump_owner' && req.user.id !== pumpOwnerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view your own staff.',
      });
    }

    const staff = await PumpStaff.find({ pumpOwnerId }).sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'Staff list retrieved successfully',
      data: {
        staff: staff.map((s) => ({
          id: s._id,
          mobile: s.mobile,
          name: s.name,
          pumpOwnerId: s.pumpOwnerId,
          status: s.status,
          permissions: s.permissions,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add pump staff
 * POST /api/pump-staff
 */
const addStaff = async (req, res, next) => {
  try {
    const { mobile, name, permissions } = req.body;

    if (!mobile || !name) {
      return res.status(400).json({
        success: false,
        message: 'Mobile and name are required',
      });
    }

    const cleanedMobile = cleanMobile(mobile);
    if (!validateMobile(cleanedMobile)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mobile number',
      });
    }

    const pumpOwnerId = req.user.id;

    // Check if staff with mobile already exists
    const existingStaff = await PumpStaff.findOne({ mobile: cleanedMobile });
    if (existingStaff) {
      return res.status(400).json({
        success: false,
        message: 'Staff with this mobile number already exists',
      });
    }

    // Ensure attendants have restricted permissions (cannot view reports/settlements)
    const defaultPermissions = {
      canProcessFuel: true, // They need to scan QR and submit fuel amount
      canViewTransactions: false, // Cannot see reports
      canViewSettlements: false, // Cannot see settlements
      canManageStaff: false,
    };

    // Merge provided permissions with defaults, but enforce restrictions
    const finalPermissions = {
      ...defaultPermissions,
      ...(permissions || {}),
      // Force these to false regardless of what's provided
      canViewTransactions: false,
      canViewSettlements: false,
    };

    const staff = new PumpStaff({
      mobile: cleanedMobile,
      name,
      pumpOwnerId,
      permissions: finalPermissions,
    });

    await staff.save();

    return res.status(201).json({
      success: true,
      message: 'Staff added successfully',
      data: {
        staff: {
          id: staff._id,
          mobile: staff.mobile,
          name: staff.name,
          pumpOwnerId: staff.pumpOwnerId,
          status: staff.status,
          permissions: staff.permissions,
        },
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Staff with this mobile number already exists',
      });
    }
    next(error);
  }
};

/**
 * Update pump staff
 * PUT /api/pump-staff/:id
 */
const updateStaff = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, permissions, status } = req.body;

    const staff = await PumpStaff.findById(id);

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found',
      });
    }

    // Check authorization - only pump owner can update their staff
    if (req.user.userType === 'pump_owner' && req.user.id !== staff.pumpOwnerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only update your own staff.',
      });
    }

    if (name !== undefined) staff.name = name;
    if (permissions !== undefined) {
      // Merge permissions but enforce restrictions
      staff.permissions = {
        ...staff.permissions,
        ...permissions,
        // Force these to false - attendants cannot view reports/settlements
        canViewTransactions: false,
        canViewSettlements: false,
      };
    }
    if (status !== undefined) staff.status = status;

    await staff.save();

    return res.status(200).json({
      success: true,
      message: 'Staff updated successfully',
      data: {
        staff: {
          id: staff._id,
          mobile: staff.mobile,
          name: staff.name,
          pumpOwnerId: staff.pumpOwnerId,
          status: staff.status,
          permissions: staff.permissions,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Disable pump staff
 * PUT /api/pump-staff/:id/disable
 */
const disableStaff = async (req, res, next) => {
  try {
    const { id } = req.params;

    const staff = await PumpStaff.findById(id);

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found',
      });
    }

    // Check authorization - only pump owner can disable their staff
    if (req.user.userType === 'pump_owner' && req.user.id !== staff.pumpOwnerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only disable your own staff.',
      });
    }

    staff.status = 'disabled';
    await staff.save();

    return res.status(200).json({
      success: true,
      message: 'Staff disabled successfully',
      data: {
        staff: {
          id: staff._id,
          mobile: staff.mobile,
          name: staff.name,
          status: staff.status,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listStaff,
  addStaff,
  updateStaff,
  disableStaff,
};
