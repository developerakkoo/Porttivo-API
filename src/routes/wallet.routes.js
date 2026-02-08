const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getBalance,
  addMoney,
  getTransactions,
  transferToBank,
  getBanks,
} = require('../controllers/wallet.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/wallets/balance
 * @desc    Get wallet balance
 * @access  Private
 */
router.get('/balance', getBalance);

/**
 * @route   POST /api/wallets/add-money
 * @desc    Add money to wallet
 * @access  Private (Transporter/Pump Owner)
 */
router.post('/add-money', addMoney);

/**
 * @route   GET /api/wallets/transactions
 * @desc    Get wallet transaction history
 * @access  Private
 */
router.get('/transactions', getTransactions);

/**
 * @route   POST /api/wallets/transfer
 * @desc    Transfer money to bank (drivers only)
 * @access  Private (Driver only)
 */
router.post('/transfer', transferToBank);

/**
 * @route   GET /api/wallets/banks
 * @desc    Get bank list for transfer
 * @access  Private
 */
router.get('/banks', getBanks);

module.exports = router;
