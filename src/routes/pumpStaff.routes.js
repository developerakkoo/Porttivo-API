const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { listStaff, addStaff, updateStaff, disableStaff } = require('../controllers/pumpStaff.controller');

// All routes require authentication
router.use(authenticate);

// Verify user is a pump owner or admin
router.use((req, res, next) => {
  if (req.user.userType !== 'pump_owner' && req.user.userType !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for pump owners and admins only.',
    });
  }
  next();
});

/**
 * @route   GET /api/pump-staff
 * @desc    List pump staff
 * @access  Private (Pump Owner/Admin only)
 */
router.get('/', listStaff);

/**
 * @route   POST /api/pump-staff
 * @desc    Add pump staff
 * @access  Private (Pump Owner only)
 */
router.post('/', addStaff);

/**
 * @route   PUT /api/pump-staff/:id
 * @desc    Update pump staff
 * @access  Private (Pump Owner/Admin only)
 */
router.put('/:id', updateStaff);

/**
 * @route   PUT /api/pump-staff/:id/disable
 * @desc    Disable pump staff
 * @access  Private (Pump Owner/Admin only)
 */
router.put('/:id/disable', disableStaff);

module.exports = router;
