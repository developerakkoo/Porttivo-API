const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  listSettlements,
  getSettlement,
  calculateSettlement,
  processSettlement,
  completeSettlement,
  getPendingSettlements,
} = require('../controllers/settlement.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/settlements
 * @desc    List settlements
 * @access  Private (Pump Owner/Admin)
 */
router.get('/', listSettlements);

/**
 * @route   GET /api/settlements/pending
 * @desc    Get pending settlements
 * @access  Private (Pump Owner/Admin)
 */
router.get('/pending', getPendingSettlements);

/**
 * @route   GET /api/settlements/:id
 * @desc    Get settlement details
 * @access  Private (Pump Owner/Admin)
 */
router.get('/:id', getSettlement);

/**
 * @route   POST /api/settlements/calculate
 * @desc    Calculate settlement (Admin only)
 * @access  Private (Admin only)
 */
router.post('/calculate', calculateSettlement);

/**
 * @route   PUT /api/settlements/:id/process
 * @desc    Process settlement (Admin only)
 * @access  Private (Admin only)
 */
router.put('/:id/process', processSettlement);

/**
 * @route   PUT /api/settlements/:id/complete
 * @desc    Complete settlement with UTR (Admin only)
 * @access  Private (Admin only)
 */
router.put('/:id/complete', completeSettlement);

module.exports = router;
