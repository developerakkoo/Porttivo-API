const PumpOwner = require('../models/PumpOwner');
const FuelTransaction = require('../models/FuelTransaction');
const { validateMobile, cleanMobile } = require('../utils/validation');

/**
 * Get pump owner profile
 * GET /api/pump-owners/profile
 */
const getProfile = async (req, res, next) => {
  try {
    const pumpOwner = await PumpOwner.findById(req.user.id);

    if (!pumpOwner) {
      return res.status(404).json({
        success: false,
        message: 'Pump owner not found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Profile retrieved successfully',
      data: {
        pumpOwner: {
          id: pumpOwner._id,
          mobile: pumpOwner.mobile,
          name: pumpOwner.name,
          email: pumpOwner.email,
          pumpName: pumpOwner.pumpName,
          location: pumpOwner.location,
          status: pumpOwner.status,
          walletBalance: pumpOwner.walletBalance,
          commissionRate: pumpOwner.commissionRate,
          totalDriversVisited: pumpOwner.totalDriversVisited,
          totalTransporters: pumpOwner.totalTransporters,
          totalFuelValue: pumpOwner.totalFuelValue,
          createdAt: pumpOwner.createdAt,
          updatedAt: pumpOwner.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update pump owner profile
 * PUT /api/pump-owners/profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const { name, email, pumpName, location } = req.body;

    const pumpOwner = await PumpOwner.findById(req.user.id);

    if (!pumpOwner) {
      return res.status(404).json({
        success: false,
        message: 'Pump owner not found',
      });
    }

    // Update fields
    if (name !== undefined) pumpOwner.name = name;
    if (email !== undefined) pumpOwner.email = email;
    if (pumpName !== undefined) pumpOwner.pumpName = pumpName;
    if (location !== undefined) pumpOwner.location = location;

    await pumpOwner.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        pumpOwner: {
          id: pumpOwner._id,
          mobile: pumpOwner.mobile,
          name: pumpOwner.name,
          email: pumpOwner.email,
          pumpName: pumpOwner.pumpName,
          location: pumpOwner.location,
          status: pumpOwner.status,
          walletBalance: pumpOwner.walletBalance,
          commissionRate: pumpOwner.commissionRate,
        },
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email or pump name already exists',
      });
    }
    next(error);
  }
};

/**
 * Get pump owner dashboard
 * GET /api/pump-owners/dashboard
 */
const getDashboard = async (req, res, next) => {
  try {
    const pumpOwnerId = req.user.id;
    const { startDate, endDate } = req.query;

    // Build date filter
    const dateFilter = {};
    if (startDate || endDate) {
      dateFilter.createdAt = {};
      if (startDate) {
        dateFilter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        dateFilter.createdAt.$lte = new Date(endDate);
      }
    }

    // Build query for all Porttivo transactions
    const allTransactionsQuery = {
      pumpOwnerId,
      ...dateFilter,
    };

    // Build query for completed transactions (for fuel value calculation)
    const completedTransactionsQuery = {
      pumpOwnerId,
      status: 'completed',
      ...dateFilter,
    };

    // Get total transaction count (all Porttivo transactions)
    const transactionCount = await FuelTransaction.countDocuments(allTransactionsQuery);

    // Calculate total fuel value (sum of amount from completed transactions only)
    const fuelValueResult = await FuelTransaction.aggregate([
      { $match: completedTransactionsQuery },
      {
        $group: {
          _id: null,
          totalFuelValue: { $sum: '$amount' },
        },
      },
    ]);

    const porttivoFuelValue = fuelValueResult.length > 0 ? fuelValueResult[0].totalFuelValue : 0;

    // Get recent transactions (last 10) - all Porttivo transactions
    const recentTransactions = await FuelTransaction.find(allTransactionsQuery)
      .populate('driverId', 'name mobile')
      .populate('pumpStaffId', 'name mobile')
      .populate('fuelCardId', 'cardNumber')
      .sort({ createdAt: -1 })
      .limit(10)
      .select('transactionId vehicleNumber amount status createdAt pumpStaffId driverId');

    // Format recent transactions
    const formattedTransactions = recentTransactions.map((txn) => ({
      id: txn._id,
      transactionId: txn.transactionId,
      date: txn.createdAt,
      vehicle: txn.vehicleNumber,
      amount: txn.amount,
      attendant: txn.pumpStaffId
        ? {
            id: txn.pumpStaffId._id,
            name: txn.pumpStaffId.name,
            mobile: txn.pumpStaffId.mobile,
          }
        : null,
      driver: txn.driverId
        ? {
            id: txn.driverId._id,
            name: txn.driverId.name,
            mobile: txn.driverId.mobile,
          }
        : null,
      status: txn.status,
    }));

    return res.status(200).json({
      success: true,
      message: 'Dashboard data retrieved successfully',
      data: {
        dashboard: {
          porttivoTransactionCount: transactionCount,
          porttivoFuelValue: porttivoFuelValue,
          recentTransactions: formattedTransactions,
          period: {
            startDate: startDate ? new Date(startDate) : null,
            endDate: endDate ? new Date(endDate) : null,
          },
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
  getDashboard,
};
