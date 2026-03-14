const FuelTransaction = require('../models/FuelTransaction');
const FuelCard = require('../models/FuelCard');
const Driver = require('../models/Driver');
const Vehicle = require('../models/Vehicle');
const { generateQRCode, validateQRCode, generateTransactionId } = require('../services/qrCode.service');
const { runFraudChecks } = require('../services/fraudDetection.service');
const { upload } = require('../middleware/upload.middleware');
const { getOrCreateWallet, debitWallet, creditWallet } = require('../services/walletLedger.service');

const DEFAULT_CASHBACK_RATE = 2;

const roundCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const ensureFuelAccessForTransporter = async (transaction, transporterId) => {
  if (transaction.transporterId?.toString() === transporterId) {
    return true;
  }

  const driver = await Driver.findById(transaction.driverId).select('transporterId');
  return driver?.transporterId?.toString() === transporterId;
};

/**
 * Generate QR code for fuel transaction
 * POST /api/fuel/generate-qr
 */
const generateQR = async (req, res, next) => {
  try {
    // Only drivers can generate QR codes
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can generate QR codes.',
      });
    }

    const driverId = req.user.id;
    const { vehicleNumber, amount, latitude, longitude } = req.body;

    if (!vehicleNumber || !amount || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle number, amount, and GPS location (latitude, longitude) are required',
      });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0',
      });
    }

    // Get driver's assigned fuel card
    const fuelCard = await FuelCard.findOne({
      driverId,
      status: 'active',
    });

    if (!fuelCard) {
      return res.status(404).json({
        success: false,
        message: 'No active fuel card assigned to you',
      });
    }

    const transporterWallet = await getOrCreateWallet({
      userId: fuelCard.transporterId,
      userType: 'TRANSPORTER',
    });

    // Check transporter wallet balance
    if (transporterWallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient transporter wallet balance',
        data: {
          balance: transporterWallet.balance,
          required: amount,
        },
      });
    }

    // Validate vehicle (optional - check if vehicle exists)
    const vehicle = await Vehicle.findOne({
      vehicleNumber: vehicleNumber.toUpperCase(),
    });

    // Generate transaction ID
    const transactionId = generateTransactionId();

    // Create transaction
    const transaction = new FuelTransaction({
      transactionId,
      driverId,
      transporterId: fuelCard.transporterId,
      transactionType: 'PORTTIVO_CARD',
      fuelCardId: fuelCard._id,
      vehicleNumber: vehicleNumber.toUpperCase(),
      amount,
      location: {
        latitude,
        longitude,
        accuracy: req.body.accuracy || null,
        address: req.body.address || null,
      },
      status: 'pending',
      settlementStatus: 'UNSETTLED',
      qrCodeExpiry: new Date(Date.now() + 60 * 60 * 1000), // 1 hour expiry
    });

    // Generate QR code
    const qrData = await generateQRCode({
      transactionId,
      driverId,
      fuelCardId: fuelCard._id.toString(),
      amount,
      vehicleNumber: vehicleNumber.toUpperCase(),
    });

    transaction.qrCode = qrData.qrCode;
    await transaction.save();

    // Populate references
    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('fuelCardId', 'cardNumber balance');

    res.json({
      success: true,
      message: 'QR code generated successfully',
      data: {
        transaction: transaction.toObject(),
        qrCodeImage: qrData.qrCodeImage,
        qrCode: qrData.qrCode, // For testing/debugging
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Validate QR code
 * POST /api/fuel/validate-qr
 */
const validateQR = async (req, res, next) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode) {
      return res.status(400).json({
        success: false,
        message: 'QR code is required',
      });
    }

    // Validate and decrypt QR code
    const payload = validateQRCode(qrCode);

    // Find transaction
    const transaction = await FuelTransaction.findOne({
      transactionId: payload.transactionId,
      qrCode: qrCode,
    })
      .populate('driverId', 'name mobile')
      .populate('fuelCardId', 'cardNumber balance')
      .populate('pumpOwnerId', 'name pumpName');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check if QR is expired
    if (transaction.isQRExpired()) {
      return res.status(400).json({
        success: false,
        message: 'QR code has expired',
      });
    }

    // Check transaction status
    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Transaction is already ${transaction.status}`,
      });
    }

    res.json({
      success: true,
      message: 'QR code is valid',
      data: {
        transaction: transaction.toObject(),
        payload,
      },
    });
  } catch (error) {
    if (error.message === 'QR code has expired' || error.message === 'Invalid QR code') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Scan QR and initiate transaction (Driver)
 * POST /api/fuel/scan-qr
 */
const scanQR = async (req, res, next) => {
  try {
    // This endpoint is for drivers to scan QR codes displayed at pump
    // For now, we'll use the validate QR endpoint
    // This can be enhanced for pump-side QR scanning
    return validateQR(req, res, next);
  } catch (error) {
    next(error);
  }
};

/**
 * Confirm fuel amount (Driver)
 * POST /api/fuel/confirm
 */
const confirmTransaction = async (req, res, next) => {
  try {
    // Only drivers can confirm transactions
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can confirm transactions.',
      });
    }

    const { transactionId, amount } = req.body;
    const driverId = req.user.id;

    if (!transactionId || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID and amount are required',
      });
    }

    // Find transaction
    const transaction = await FuelTransaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check driver access
    if (transaction.driverId.toString() !== driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This transaction does not belong to you.',
      });
    }

    // Check transaction status
    if (transaction.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Transaction cannot be confirmed. Current status: ${transaction.status}`,
      });
    }

    // Check if QR is expired
    if (transaction.isQRExpired()) {
      return res.status(400).json({
        success: false,
        message: 'QR code has expired. Please generate a new QR code.',
      });
    }

    // Update amount if different
    if (amount !== transaction.amount) {
      const fuelCard = await FuelCard.findById(transaction.fuelCardId);
      const transporterWallet = await getOrCreateWallet({
        userId: fuelCard.transporterId,
        userType: 'TRANSPORTER',
      });

      if (transporterWallet.balance < amount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient transporter wallet balance',
          data: {
            balance: transporterWallet.balance,
            required: amount,
          },
        });
      }
      transaction.amount = amount;
    }

    // Update transaction status
    transaction.status = 'confirmed';
    transaction.confirmedAt = new Date();
    await transaction.save();

    // Populate references
    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('fuelCardId', 'cardNumber balance');
    await transaction.populate('pumpOwnerId', 'name pumpName');

    res.json({
      success: true,
      message: 'Transaction confirmed successfully',
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Cancel fuel transaction (Driver)
 * POST /api/fuel/cancel
 */
const cancelTransaction = async (req, res, next) => {
  try {
    // Only drivers can cancel transactions
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can cancel transactions.',
      });
    }

    const { transactionId } = req.body;
    const driverId = req.user.id;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required',
      });
    }

    // Find transaction
    const transaction = await FuelTransaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check driver access
    if (transaction.driverId.toString() !== driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This transaction does not belong to you.',
      });
    }

    // Check transaction status
    if (transaction.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel completed transaction',
      });
    }

    if (transaction.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Transaction is already cancelled',
      });
    }

    // Update transaction status
    transaction.status = 'cancelled';
    transaction.cancelledAt = new Date();
    transaction.cancelledBy = driverId;
    await transaction.save();

    // Populate references
    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('fuelCardId', 'cardNumber balance');

    res.json({
      success: true,
      message: 'Transaction cancelled successfully',
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit fuel amount (Pump Staff via QR scan)
 * POST /api/fuel/submit
 */
const submitTransaction = async (req, res, next) => {
  try {
    // Only pump staff can submit transactions
    if (req.user.userType !== 'pump_staff') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only pump staff can submit transactions.',
      });
    }

    const { qrCode, amount, latitude, longitude } = req.body;
    const pumpStaffId = req.user.id;

    if (!qrCode || !amount || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'QR code, amount, and GPS location are required',
      });
    }

    // Validate and decrypt QR code
    const payload = validateQRCode(qrCode);

    // Find transaction
    const transaction = await FuelTransaction.findOne({
      transactionId: payload.transactionId,
      qrCode: qrCode,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check transaction status
    if (transaction.status !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Transaction must be confirmed before submission. Current status: ${transaction.status}`,
      });
    }

    // Get pump owner from staff
    // Note: This assumes pump staff model has pumpOwnerId field
    // You may need to adjust based on your PumpStaff model
    const pumpOwnerId = req.user.userData?.pumpOwnerId || req.body.pumpOwnerId;

    if (!pumpOwnerId) {
      return res.status(400).json({
        success: false,
        message: 'Pump owner ID is required',
      });
    }

    // Update transaction
    transaction.pumpOwnerId = pumpOwnerId;
    transaction.pumpStaffId = pumpStaffId;
    transaction.amount = amount;
    transaction.location = {
      latitude,
      longitude,
      accuracy: req.body.accuracy || null,
      address: req.body.address || null,
    };
    transaction.status = 'completed';
    transaction.completedAt = new Date();

    const fuelCard = await FuelCard.findById(transaction.fuelCardId);
    const transporterWallet = await getOrCreateWallet({
      userId: fuelCard.transporterId,
      userType: 'TRANSPORTER',
    });

    if (transporterWallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient transporter wallet balance',
      });
    }

    const { wallet, transaction: walletTransaction } = await debitWallet({
      userId: fuelCard.transporterId,
      userType: 'TRANSPORTER',
      amount,
      reference: transaction.transactionId,
      referenceType: 'FUEL',
      description: `Fuel card purchase for ${transaction.vehicleNumber}`,
      metadata: {
        fuelTransactionId: transaction._id,
        fuelCardId: fuelCard._id,
        driverId: transaction.driverId,
        pumpOwnerId,
      },
    });

    fuelCard.balance = wallet.balance;
    fuelCard.lastUsedAt = new Date();
    await fuelCard.save();

    // Run fraud detection checks
    const pumpLocation = { latitude, longitude };
    const fraudFlags = await runFraudChecks(transaction, pumpLocation);
    transaction.fraudFlags = fraudFlags;
    transaction.transporterId = fuelCard.transporterId;
    transaction.walletTransactionId = walletTransaction._id;

    // If fraud detected, set status to flagged
    if (transaction.hasFraudFlags()) {
      transaction.status = 'flagged';
      transaction.settlementStatus = 'UNSETTLED';
    }

    await transaction.save();

    // Populate references
    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('fuelCardId', 'cardNumber balance');
    await transaction.populate('pumpOwnerId', 'name pumpName');
    await transaction.populate('pumpStaffId', 'name mobile');

    res.json({
      success: true,
      message: 'Transaction submitted successfully',
      data: transaction,
      fraudDetected: transaction.hasFraudFlags(),
    });
  } catch (error) {
    if (error.message === 'QR code has expired' || error.message === 'Invalid QR code') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Get all transactions
 * GET /api/fuel/transactions
 */
const getTransactions = async (req, res, next) => {
  try {
    const userType = req.user.userType;
    const userId = req.user.id;
    const { status, driverId, pumpOwnerId, vehicleNumber, transactionType, reviewStatus, startDate, endDate, page = 1, limit = 20 } = req.query;

    // Build query based on user type
    let query = {};

    if (userType === 'driver') {
      query.driverId = userId;
    } else if (userType === 'transporter') {
      query.transporterId = userId;
    } else if (userType === 'pump_owner') {
      query.pumpOwnerId = userId;
    } else if (userType === 'pump_staff') {
      query.pumpStaffId = userId;
    }
    // Admin can see all

    if (status) {
      query.status = status;
    }
    if (driverId) {
      query.driverId = driverId;
    }
    if (pumpOwnerId) {
      query.pumpOwnerId = pumpOwnerId;
    }
    if (vehicleNumber) {
      query.vehicleNumber = vehicleNumber.toUpperCase();
    }
    if (transactionType) {
      query.transactionType = transactionType;
    }
    if (reviewStatus) {
      query['review.status'] = reviewStatus;
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

    const transactions = await FuelTransaction.find(query)
      .populate('driverId', 'name mobile')
      .populate('fuelCardId', 'cardNumber balance')
      .populate('pumpOwnerId', 'name pumpName')
      .populate('pumpStaffId', 'name mobile')
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

/**
 * Get transaction details
 * GET /api/fuel/transactions/:id
 */
const getTransactionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userType = req.user.userType;
    const userId = req.user.id;

    const transaction = await FuelTransaction.findById(id)
      .populate('driverId', 'name mobile')
      .populate('fuelCardId', 'cardNumber balance')
      .populate('pumpOwnerId', 'name pumpName')
      .populate('pumpStaffId', 'name mobile');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check access
    if (userType === 'driver') {
      if (transaction.driverId._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied.',
        });
      }
    } else if (userType === 'transporter') {
      const hasAccess = await ensureFuelAccessForTransporter(transaction, userId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied.',
        });
      }
    } else if (userType === 'pump_owner') {
      // Handle both populated (object) and unpopulated (ObjectId) pumpOwnerId
      const transactionPumpOwnerId = transaction.pumpOwnerId?._id 
        ? transaction.pumpOwnerId._id.toString() 
        : transaction.pumpOwnerId?.toString();
      if (!transactionPumpOwnerId || transactionPumpOwnerId !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied.',
        });
      }
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
 * Upload receipt photo
 * POST /api/fuel/transactions/:id/receipt
 */
const uploadReceipt = async (req, res, next) => {
  try {
    // Only drivers can upload receipts
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can upload receipts.',
      });
    }

    const { id } = req.params;
    const driverId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Receipt photo is required',
      });
    }

    // Find transaction
    const transaction = await FuelTransaction.findById(id);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check driver access
    if (transaction.driverId.toString() !== driverId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This transaction does not belong to you.',
      });
    }

    // Check transaction status
    if (transaction.status !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Receipt can only be uploaded for completed transactions',
      });
    }

    // Get photo URL
    const photoUrl = `/uploads/receipts/${req.file.filename}`;

    // Update transaction receipt
    transaction.receipt = {
      photo: photoUrl,
      uploadedAt: new Date(),
      uploadedBy: driverId,
    };

    // Re-run fraud checks (especially duplicate receipt check)
    const pumpLocation = transaction.location;
    const fraudFlags = await runFraudChecks(transaction, pumpLocation);
    transaction.fraudFlags = { ...transaction.fraudFlags, ...fraudFlags };

    // If fraud detected, set status to flagged
    if (transaction.hasFraudFlags() && transaction.status !== 'flagged') {
      transaction.status = 'flagged';
    }

    await transaction.save();

    // Populate references
    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('fuelCardId', 'cardNumber balance');
    await transaction.populate('pumpOwnerId', 'name pumpName');

    res.json({
      success: true,
      message: 'Receipt uploaded successfully',
      data: transaction,
      fraudDetected: transaction.hasFraudFlags(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get receipt preview
 * GET /api/fuel/receipt/:id
 */
const getReceipt = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userType = req.user.userType;
    const userId = req.user.id;

    const transaction = await FuelTransaction.findById(id)
      .populate('driverId', 'name mobile')
      .populate('fuelCardId', 'cardNumber')
      .populate('pumpOwnerId', 'name pumpName')
      .populate('pumpStaffId', 'name mobile');

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found',
      });
    }

    // Check access (same as getTransactionById)
    if (userType === 'driver') {
      if (transaction.driverId._id.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied.',
        });
      }
    }

    // Build receipt data
    const receipt = {
      transactionId: transaction.transactionId,
      date: transaction.completedAt || transaction.createdAt,
      driver: {
        name: transaction.driverId.name,
        mobile: transaction.driverId.mobile,
      },
      vehicleNumber: transaction.vehicleNumber,
      pump: {
        name: transaction.pumpOwnerId?.name || 'N/A',
        pumpName: transaction.pumpOwnerId?.pumpName || 'N/A',
      },
      amount: transaction.amount,
      fuelCard: transaction.fuelCardId?.cardNumber || 'N/A',
      receiptPhoto: transaction.receipt?.photo || null,
      location: transaction.location,
    };

    res.json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Submit cash fuel receipt
 * POST /api/fuel/cash-receipts
 */
const submitCashReceipt = async (req, res, next) => {
  try {
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers can submit cash fuel receipts.',
      });
    }

    const { amount, vehicleNumber, latitude, longitude, address, notes, pumpOwnerId, tripId } = req.body;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Receipt photo is required',
      });
    }

    if (!amount || amount <= 0 || !vehicleNumber || latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Amount, vehicle number, and GPS location are required',
      });
    }

    const driver = await Driver.findById(req.user.id).select('transporterId');
    if (!driver) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    const cashbackAmount = roundCurrency((Number(amount) * DEFAULT_CASHBACK_RATE) / 100);
    const receiptPhoto = `/uploads/receipts/${req.file.filename}`;

    const transaction = await FuelTransaction.create({
      transactionId: generateTransactionId(),
      transactionType: 'CASH_RECEIPT',
      status: 'completed',
      settlementStatus: 'NOT_APPLICABLE',
      driverId: req.user.id,
      transporterId: driver.transporterId || null,
      tripId: tripId || null,
      pumpOwnerId: pumpOwnerId || null,
      vehicleNumber: vehicleNumber.toUpperCase(),
      amount,
      qrCode: null,
      qrCodeExpiry: null,
      location: {
        latitude,
        longitude,
        address: address || null,
        accuracy: req.body.accuracy || null,
      },
      receipt: {
        photo: receiptPhoto,
        uploadedAt: new Date(),
        uploadedBy: req.user.id,
      },
      notes: notes?.trim() || null,
      review: {
        status: 'PENDING',
      },
      cashback: {
        eligible: true,
        rate: DEFAULT_CASHBACK_RATE,
        amount: cashbackAmount,
        status: 'PENDING',
      },
    });

    res.status(201).json({
      success: true,
      message: 'Cash fuel receipt submitted for review',
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * List cash fuel receipts
 * GET /api/fuel/cash-receipts
 */
const listCashReceipts = async (req, res, next) => {
  try {
    const { reviewStatus, page = 1, limit = 20 } = req.query;
    const query = { transactionType: 'CASH_RECEIPT' };

    if (req.user.userType === 'driver') {
      query.driverId = req.user.id;
    } else if (req.user.userType === 'transporter') {
      query.transporterId = req.user.id;
    } else if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    if (reviewStatus) {
      query['review.status'] = reviewStatus;
    }

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);
    const skip = (pageNum - 1) * limitNum;

    const receipts = await FuelTransaction.find(query)
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await FuelTransaction.countDocuments(query);

    res.json({
      success: true,
      data: receipts,
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
 * Review cash fuel receipt
 * PUT /api/fuel/cash-receipts/:id/review
 */
const reviewCashReceipt = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { action, notes, creditCashback = true } = req.body;

    if (!['admin', 'transporter'].includes(req.user.userType)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be APPROVE or REJECT',
      });
    }

    const transaction = await FuelTransaction.findById(id);
    if (!transaction || transaction.transactionType !== 'CASH_RECEIPT') {
      return res.status(404).json({
        success: false,
        message: 'Cash receipt not found',
      });
    }

    if (req.user.userType === 'transporter') {
      const hasAccess = await ensureFuelAccessForTransporter(transaction, req.user.id);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied.',
        });
      }
    }

    transaction.review.status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    transaction.review.reviewedAt = new Date();
    transaction.review.reviewedBy = req.user.id;
    transaction.review.notes = notes?.trim() || null;
    transaction.cashback.reviewedAt = new Date();
    transaction.cashback.reviewedBy = req.user.id;
    transaction.cashback.notes = notes?.trim() || null;

    if (action === 'REJECT') {
      transaction.cashback.status = 'REJECTED';
      await transaction.save();
    } else {
      transaction.cashback.status = creditCashback ? 'CREDITED' : 'APPROVED';

      if (creditCashback) {
        const { transaction: cashbackWalletTx } = await creditWallet({
          userId: transaction.driverId,
          userType: 'DRIVER',
          amount: transaction.cashback.amount,
          reference: transaction.transactionId,
          referenceType: 'FUEL',
          description: `Cash fuel receipt cashback for ${transaction.vehicleNumber}`,
          metadata: {
            fuelTransactionId: transaction._id,
          },
        });

        transaction.cashback.walletTransactionId = cashbackWalletTx._id;
        transaction.cashback.creditedAt = new Date();
      }

      await transaction.save();
    }

    await transaction.populate('driverId', 'name mobile');
    await transaction.populate('transporterId', 'name company mobile');

    res.json({
      success: true,
      message: `Cash fuel receipt ${action === 'APPROVE' ? 'approved' : 'rejected'} successfully`,
      data: transaction,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generateQR,
  validateQR,
  scanQR,
  confirmTransaction,
  cancelTransaction,
  submitTransaction,
  getTransactions,
  getTransactionById,
  uploadReceipt,
  getReceipt,
  submitCashReceipt,
  listCashReceipts,
  reviewCashReceipt,
};
