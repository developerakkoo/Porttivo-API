const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const { getOrCreateWallet, creditWallet, debitWallet } = require('../services/walletLedger.service');

/**
 * Get wallet balance
 * GET /api/wallets/balance
 */
const getBalance = async (req, res, next) => {
  try {
    const userType = req.user.userType.toUpperCase();
    const userId = req.user.id;

    const wallet = await getOrCreateWallet({ userId, userType });

    return res.status(200).json({
      success: true,
      message: 'Wallet balance retrieved successfully',
      data: {
        wallet: {
          id: wallet._id,
          balance: wallet.balance,
          currency: wallet.currency,
          isActive: wallet.isActive,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Add money to wallet
 * POST /api/wallets/add-money
 */
const addMoney = async (req, res, next) => {
  try {
    const { amount } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    const userType = req.user.userType.toUpperCase();
    const userId = req.user.id;

    const { wallet, transaction } = await creditWallet({
      userId,
      userType,
      amount,
      reference: `MANUAL_${Date.now()}`,
      referenceType: 'MANUAL',
      description: 'Manual wallet top-up',
      metadata: {
        initiatedBy: req.user.id,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Money added successfully',
      data: {
        wallet: {
          id: wallet._id,
          balance: wallet.balance,
          currency: wallet.currency,
        },
        transaction: {
          id: transaction._id,
          type: transaction.type,
          amount: transaction.amount,
          balanceAfter: transaction.balanceAfter,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get wallet transaction history
 * GET /api/wallets/transactions
 */
const getTransactions = async (req, res, next) => {
  try {
    const userType = req.user.userType.toUpperCase();
    const userId = req.user.id;
    const { page = 1, limit = 20, type, status } = req.query;

    const wallet = await Wallet.findOne({ userId, userType });

    if (!wallet) {
      return res.status(200).json({
        success: true,
        message: 'No transactions found',
        data: {
          transactions: [],
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: 0,
            pages: 0,
          },
        },
      });
    }

    const query = { walletId: wallet._id };
    if (type) query.type = type;
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const transactions = await WalletTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await WalletTransaction.countDocuments(query);

    return res.status(200).json({
      success: true,
      message: 'Transactions retrieved successfully',
      data: {
        transactions: transactions.map((t) => ({
          id: t._id,
          type: t.type,
          amount: t.amount,
          balanceBefore: t.balanceBefore,
          balanceAfter: t.balanceAfter,
          reference: t.reference,
          referenceType: t.referenceType,
          status: t.status,
          description: t.description,
          createdAt: t.createdAt,
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
 * Transfer money to bank (for drivers)
 * POST /api/wallets/transfer
 */
const transferToBank = async (req, res, next) => {
  try {
    // Only drivers can transfer to bank
    if (req.user.userType !== 'driver') {
      return res.status(403).json({
        success: false,
        message: 'Only drivers can transfer to bank',
      });
    }

    const { amount, bankAccountId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required',
      });
    }

    if (!bankAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Bank account ID is required',
      });
    }

    const userType = 'DRIVER';
    const userId = req.user.id;

    const wallet = await Wallet.findOne({ userId, userType });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found',
      });
    }

    if (wallet.withdrawalPaused) {
      return res.status(403).json({
        success: false,
        message: wallet.withdrawalPauseReason || 'Withdrawals are paused for this wallet',
      });
    }

    const { wallet: updatedWallet, transaction } = await debitWallet({
      userId,
      userType,
      amount,
      reference: `BANK_TRANSFER_${Date.now()}`,
      referenceType: 'BANK_TRANSFER',
      description: `Transfer to bank account ${bankAccountId}`,
      metadata: {
        bankAccountId,
      },
    });

    transaction.type = 'TRANSFER';
    transaction.status = 'PENDING';
    await transaction.save();

    return res.status(200).json({
      success: true,
      message: 'Transfer initiated successfully',
      data: {
        wallet: {
          id: updatedWallet._id,
          balance: updatedWallet.balance,
        },
        transaction: {
          id: transaction._id,
          type: transaction.type,
          amount: transaction.amount,
          status: transaction.status,
        },
      },
    });
  } catch (error) {
    if (error.message === 'Insufficient balance') {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }
    next(error);
  }
};

/**
 * Get bank list for transfer
 * GET /api/wallets/banks
 */
const getBanks = async (req, res, next) => {
  try {
    // This would typically come from a database or external API
    // For now, returning a mock list
    const banks = [
      { id: '1', name: 'State Bank of India', code: 'SBI' },
      { id: '2', name: 'HDFC Bank', code: 'HDFC' },
      { id: '3', name: 'ICICI Bank', code: 'ICICI' },
      { id: '4', name: 'Axis Bank', code: 'AXIS' },
      { id: '5', name: 'Punjab National Bank', code: 'PNB' },
    ];

    return res.status(200).json({
      success: true,
      message: 'Banks retrieved successfully',
      data: {
        banks,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBalance,
  addMoney,
  getTransactions,
  transferToBank,
  getBanks,
};
