const FuelTransaction = require('../models/FuelTransaction');
const { getFraudStatistics } = require('../services/fraudDetection.service');

/**
 * Get fraud alerts
 * GET /api/fuel/fraud-alerts
 */
const getFraudAlerts = async (req, res, next) => {
  try {
    // Only admins can view fraud alerts
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can view fraud alerts.',
      });
    }

    const { resolved, fraudType, page = 1, limit = 20, startDate, endDate } = req.query;

    // Build query
    const query = {
      $or: [
        { 'fraudFlags.duplicateReceipt': true },
        { 'fraudFlags.gpsMismatch': true },
        { 'fraudFlags.expressUploads': true },
        { 'fraudFlags.unusualPattern': true },
      ],
    };

    if (resolved === 'true') {
      query['fraudFlags.resolved'] = true;
    } else if (resolved === 'false') {
      query['fraudFlags.resolved'] = false;
    }

    if (fraudType) {
      query[`fraudFlags.${fraudType}`] = true;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate);
      }
    }

    // Pagination
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const alerts = await FuelTransaction.find(query)
      .populate('driverId', 'name mobile')
      .populate('fuelCardId', 'cardNumber')
      .populate('pumpOwnerId', 'name pumpName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await FuelTransaction.countDocuments(query);

    res.json({
      success: true,
      data: alerts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get fraud alert details
 * GET /api/fuel/fraud-alerts/:id
 */
const getFraudAlertById = async (req, res, next) => {
  try {
    // Only admins can view fraud alerts
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can view fraud alerts.',
      });
    }

    const { id } = req.params;

    const transaction = await FuelTransaction.findById(id)
      .populate('driverId', 'name mobile transporterId')
      .populate('fuelCardId', 'cardNumber balance')
      .populate('pumpOwnerId', 'name pumpName')
      .populate('pumpStaffId', 'name mobile');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    if (!transaction.hasFraudFlags()) {
      return res.status(400).json({
        success: false,
        message: 'This transaction does not have fraud flags',
      });
    }

    res.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Flag transaction as fraud
 * POST /api/fuel/transactions/:id/flag
 */
const flagTransaction = async (req, res, next) => {
  try {
    // Only admins can manually flag transactions
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can flag transactions.',
      });
    }

    const { id } = req.params;
    const adminId = req.user.id;
    const { reason, fraudType } = req.body;

    const transaction = await FuelTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Update fraud flags
    if (fraudType) {
      transaction.fraudFlags[fraudType] = true;
    } else {
      // Flag all types if no specific type provided
      transaction.fraudFlags.duplicateReceipt = true;
      transaction.fraudFlags.gpsMismatch = true;
      transaction.fraudFlags.expressUploads = true;
      transaction.fraudFlags.unusualPattern = true;
    }

    transaction.fraudFlags.flaggedBy = adminId;
    transaction.fraudFlags.flaggedAt = new Date();
    transaction.fraudFlags.resolved = false;
    transaction.status = 'flagged';

    if (reason) {
      transaction.notes = reason;
    }

    await transaction.save();

    // Populate references
    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('fuelCardId', 'cardNumber balance');
    await transaction.populate('pumpOwnerId', 'name pumpName');

    res.json({
      success: true,
      message: 'Transaction flagged as fraud',
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Resolve fraud alert
 * PUT /api/fuel/fraud-alerts/:id/resolve
 */
const resolveFraudAlert = async (req, res, next) => {
  try {
    // Only admins can resolve fraud alerts
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can resolve fraud alerts.',
      });
    }

    const { id } = req.params;
    const adminId = req.user.id;
    const { resolution, isFraud } = req.body;

    const transaction = await FuelTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    if (!transaction.hasFraudFlags()) {
      return res.status(400).json({
        success: false,
        message: 'This transaction does not have fraud flags',
      });
    }

    // Update fraud flags
    transaction.fraudFlags.resolved = true;
    transaction.fraudFlags.resolvedAt = new Date();
    transaction.fraudFlags.resolvedBy = adminId;

    // If not fraud, clear flags
    if (isFraud === false) {
      transaction.fraudFlags.duplicateReceipt = false;
      transaction.fraudFlags.gpsMismatch = false;
      transaction.fraudFlags.expressUploads = false;
      transaction.fraudFlags.unusualPattern = false;
      transaction.status = 'completed';
    }

    if (resolution) {
      transaction.notes = (transaction.notes || '') + '\nResolution: ' + resolution;
    }

    await transaction.save();

    // Populate references
    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('fuelCardId', 'cardNumber balance');
    await transaction.populate('pumpOwnerId', 'name pumpName');

    res.json({
      success: true,
      message: 'Fraud alert resolved',
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get fraud statistics
 * GET /api/fuel/fraud-stats
 */
const getFraudStats = async (req, res, next) => {
  try {
    // Only admins can view fraud statistics
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can view fraud statistics.',
      });
    }

    const { startDate, endDate } = req.query;

    const stats = await getFraudStatistics({ startDate, endDate });

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getFraudAlerts,
  getFraudAlertById,
  flagTransaction,
  resolveFraudAlert,
  getFraudStats,
};
