const Settlement = require('../models/Settlement');
const FuelTransaction = require('../models/FuelTransaction');
const PumpOwner = require('../models/PumpOwner');

/**
 * List settlements
 * GET /api/settlements
 */
const listSettlements = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status, pumpOwnerId } = req.query;
    const userType = req.user.userType;

    const query = {};

    // Pump owners can only see their own settlements
    if (userType === 'pump_owner') {
      query.pumpOwnerId = req.user.id;
    } else if (pumpOwnerId) {
      query.pumpOwnerId = pumpOwnerId;
    }

    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const settlements = await Settlement.find(query)
      .populate('pumpOwnerId', 'name pumpName mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Settlement.countDocuments(query);

    return res.status(200).json({
      success: true,
      message: 'Settlements retrieved successfully',
      data: {
        settlements: settlements.map((s) => ({
          id: s._id,
          pumpOwner: s.pumpOwnerId,
          period: s.period,
          startDate: s.startDate,
          endDate: s.endDate,
          fuelValue: s.fuelValue,
          commission: s.commission,
          commissionRate: s.commissionRate,
          netPayable: s.netPayable,
          status: s.status,
          utr: s.utr,
          transactionCount: s.transactions ? s.transactions.length : 0,
          processedAt: s.processedAt,
          completedAt: s.completedAt,
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
 * Get settlement details
 * GET /api/settlements/:id
 */
const getSettlement = async (req, res, next) => {
  try {
    const { id } = req.params;

    const settlement = await Settlement.findById(id)
      .populate('pumpOwnerId', 'name pumpName mobile')
      .populate('transactions')
      .populate('processedBy', 'username email');

    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found',
      });
    }

    // Check authorization
    if (req.user.userType === 'pump_owner') {
      // Handle both populated (object) and unpopulated (ObjectId) pumpOwnerId
      const settlementPumpOwnerId = settlement.pumpOwnerId?._id 
        ? settlement.pumpOwnerId._id.toString() 
        : settlement.pumpOwnerId?.toString();
      if (!settlementPumpOwnerId || settlementPumpOwnerId !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied',
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Settlement retrieved successfully',
      data: {
        settlement: {
          id: settlement._id,
          pumpOwner: settlement.pumpOwnerId,
          period: settlement.period,
          startDate: settlement.startDate,
          endDate: settlement.endDate,
          fuelValue: settlement.fuelValue,
          commission: settlement.commission,
          commissionRate: settlement.commissionRate,
          netPayable: settlement.netPayable,
          status: settlement.status,
          utr: settlement.utr,
          transactions: settlement.transactions,
          transactionCount: settlement.transactions ? settlement.transactions.length : 0,
          processedAt: settlement.processedAt,
          processedBy: settlement.processedBy,
          completedAt: settlement.completedAt,
          notes: settlement.notes,
          createdAt: settlement.createdAt,
          updatedAt: settlement.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Calculate settlement (Admin only)
 * POST /api/settlements/calculate
 */
const calculateSettlement = async (req, res, next) => {
  try {
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.',
      });
    }

    const { pumpOwnerId, startDate, endDate, period } = req.body;

    if (!pumpOwnerId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Pump Owner ID, start date, and end date are required',
      });
    }

    const pumpOwner = await PumpOwner.findById(pumpOwnerId);
    if (!pumpOwner) {
      return res.status(404).json({
        success: false,
        message: 'Pump owner not found',
      });
    }

    // Get fuel transactions for the period
    const transactions = await FuelTransaction.find({
      pumpOwnerId,
      status: 'COMPLETED',
      createdAt: {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      },
    });

    const fuelValue = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    const commissionRate = pumpOwner.commissionRate || 0;
    const commission = (fuelValue * commissionRate) / 100;
    const netPayable = fuelValue - commission;

    return res.status(200).json({
      success: true,
      message: 'Settlement calculated successfully',
      data: {
        calculation: {
          pumpOwnerId,
          period: period || `${startDate} to ${endDate}`,
          startDate,
          endDate,
          transactionCount: transactions.length,
          fuelValue,
          commissionRate,
          commission,
          netPayable,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Process settlement (Admin only)
 * PUT /api/settlements/:id/process
 */
const processSettlement = async (req, res, next) => {
  try {
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.',
      });
    }

    const { id } = req.params;

    const settlement = await Settlement.findById(id);

    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found',
      });
    }

    if (settlement.status !== 'PENDING') {
      return res.status(400).json({
        success: false,
        message: `Settlement is already ${settlement.status}`,
      });
    }

    settlement.status = 'PROCESSING';
    settlement.processedAt = new Date();
    settlement.processedBy = req.user.id;

    await settlement.save();

    return res.status(200).json({
      success: true,
      message: 'Settlement processing initiated',
      data: {
        settlement: {
          id: settlement._id,
          status: settlement.status,
          processedAt: settlement.processedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Complete settlement with UTR (Admin only)
 * PUT /api/settlements/:id/complete
 */
const completeSettlement = async (req, res, next) => {
  try {
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.',
      });
    }

    const { id } = req.params;
    const { utr, notes } = req.body;

    if (!utr) {
      return res.status(400).json({
        success: false,
        message: 'UTR is required',
      });
    }

    const settlement = await Settlement.findById(id);

    if (!settlement) {
      return res.status(404).json({
        success: false,
        message: 'Settlement not found',
      });
    }

    if (settlement.status !== 'PROCESSING') {
      return res.status(400).json({
        success: false,
        message: 'Settlement must be in PROCESSING status',
      });
    }

    settlement.status = 'COMPLETED';
    settlement.utr = utr.toUpperCase();
    settlement.completedAt = new Date();
    if (notes) settlement.notes = notes;

    await settlement.save();

    return res.status(200).json({
      success: true,
      message: 'Settlement completed successfully',
      data: {
        settlement: {
          id: settlement._id,
          status: settlement.status,
          utr: settlement.utr,
          completedAt: settlement.completedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get pending settlements
 * GET /api/settlements/pending
 */
const getPendingSettlements = async (req, res, next) => {
  try {
    const query = { status: 'PENDING' };

    // Pump owners can only see their own pending settlements
    if (req.user.userType === 'pump_owner') {
      query.pumpOwnerId = req.user.id;
    }

    const settlements = await Settlement.find(query)
      .populate('pumpOwnerId', 'name pumpName mobile')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'Pending settlements retrieved successfully',
      data: {
        settlements: settlements.map((s) => ({
          id: s._id,
          pumpOwner: s.pumpOwnerId,
          period: s.period,
          startDate: s.startDate,
          endDate: s.endDate,
          fuelValue: s.fuelValue,
          commission: s.commission,
          netPayable: s.netPayable,
          createdAt: s.createdAt,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  listSettlements,
  getSettlement,
  calculateSettlement,
  processSettlement,
  completeSettlement,
  getPendingSettlements,
};
