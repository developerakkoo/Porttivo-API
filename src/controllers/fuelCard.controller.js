const FuelCard = require('../models/FuelCard');
const Driver = require('../models/Driver');
const FuelTransaction = require('../models/FuelTransaction');
const { getTransporterId } = require('../middleware/permission.middleware');

/**
 * Get all fuel cards
 * GET /api/fuel-cards
 */
const getFuelCards = async (req, res, next) => {
  try {
    const userType = req.user.userType;
    const { status, assigned } = req.query;

    let query = {};

    // Transporters and company users can only see their own cards
    const transporterId = getTransporterId(req.user);
    if (transporterId) {
      query.transporterId = transporterId;
    } else if (userType !== 'admin') {
      // Admins can see all cards, others cannot
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    if (status) {
      query.status = status;
    }

    if (assigned === 'true') {
      query.driverId = { $ne: null };
    } else if (assigned === 'false') {
      query.driverId = null;
    }

    const cards = await FuelCard.find(query)
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: cards,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create fuel card (Admin only)
 * POST /api/fuel-cards
 */
const createFuelCard = async (req, res, next) => {
  try {
    // Only admins can create fuel cards
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admins can create fuel cards.',
      });
    }

    const { cardNumber, transporterId, balance, expiryDate } = req.body;

    if (!cardNumber || !transporterId) {
      return res.status(400).json({
        success: false,
        message: 'Card number and transporter ID are required',
      });
    }

    // Check if card number already exists
    const existingCard = await FuelCard.findOne({ cardNumber: cardNumber.toUpperCase() });
    if (existingCard) {
      return res.status(400).json({
        success: false,
        message: 'Card number already exists',
      });
    }

    const card = new FuelCard({
      cardNumber: cardNumber.toUpperCase(),
      transporterId,
      balance: balance || 0,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      status: 'active',
    });

    await card.save();

    await card.populate('transporterId', 'name company');

    res.status(201).json({
      success: true,
      message: 'Fuel card created successfully',
      data: card,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Assign fuel card to driver
 * PUT /api/fuel-cards/:id/assign
 */
const assignFuelCard = async (req, res, next) => {
  try {
    // Transporters and company users with manageFuelCards permission can assign cards
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can assign fuel cards.',
      });
    }

    const { id } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID is required',
      });
    }

    // Find card
    const card = await FuelCard.findById(id);
    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Fuel card not found',
      });
    }

    // Check if card belongs to transporter
    if (card.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to assign this card.',
      });
    }

    // Check if card is active
    if (card.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Cannot assign card. Card status is ${card.status}`,
      });
    }

    // Validate driver
    const driver = await Driver.findById(driverId);
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
        message: 'Driver does not belong to your transporter account',
      });
    }

    // Unassign from previous driver if any
    if (card.driverId) {
      // Optionally notify previous driver
    }

    // Assign to new driver
    card.driverId = driverId;
    card.assignedBy = transporterId;
    card.assignedAt = new Date();
    await card.save();

    await card.populate('driverId', 'name mobile');
    await card.populate('transporterId', 'name company');

    res.json({
      success: true,
      message: 'Fuel card assigned successfully',
      data: card,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get assigned fuel card (Driver)
 * GET /api/fuel-cards/assigned
 */
const getAssignedFuelCard = async (req, res, next) => {
  try {
    // Only drivers can access this endpoint
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can view their assigned card.',
      });
    }

    const driverId = req.user.id;

    const card = await FuelCard.findOne({
      driverId,
      status: 'active',
    })
      .populate('transporterId', 'name company');

    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'No fuel card assigned to you',
      });
    }

    res.json({
      success: true,
      data: card,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get fuel card transaction history
 * GET /api/fuel-cards/:id/transactions
 */
const getFuelCardTransactions = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userType = req.user.userType;
    const userId = req.user.id;
    const { page = 1, limit = 20, startDate, endDate } = req.query;

    // Find card
    const card = await FuelCard.findById(id);
    if (!card) {
      return res.status(404).json({
        success: false,
        message: 'Fuel card not found',
      });
    }

    // Check access
    const transporterId = getTransporterId(req.user);
    if (transporterId) {
      // Transporters and company users can view their transporter's cards
      if (card.transporterId.toString() !== transporterId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view this card.',
        });
      }
    } else if (userType === 'driver') {
      if (card.driverId?.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This card is not assigned to you.',
        });
      }
    } else if (userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    // Build query
    const query = { fuelCardId: id };
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

    const transactions = await FuelTransaction.find(query)
      .populate('driverId', 'name mobile')
      .populate('pumpOwnerId', 'name pumpName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await FuelTransaction.countDocuments(query);

    res.json({
      success: true,
      data: transactions,
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

module.exports = {
  getFuelCards,
  createFuelCard,
  assignFuelCard,
  getAssignedFuelCard,
  getFuelCardTransactions,
};
