const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { getProfile, updateProfile, getDashboard } = require('../controllers/pumpOwner.controller');

// All routes require authentication
router.use(authenticate);

// Verify user is a pump owner
router.use((req, res, next) => {
  if (req.user.userType !== 'pump_owner') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for pump owners only.',
    });
  }
  next();
});

/**
 * @route   GET /api/pump-owners/dashboard
 * @desc    Get pump owner dashboard
 * @access  Private (Pump Owner only)
 */
router.get('/dashboard', getDashboard);

/**
 * @route   GET /api/pump-owners/profile
 * @desc    Get pump owner profile
 * @access  Private (Pump Owner only)
 */
router.get('/profile', getProfile);

/**
 * @route   PUT /api/pump-owners/profile
 * @desc    Update pump owner profile
 * @access  Private (Pump Owner only)
 */
router.put('/profile', updateProfile);

module.exports = router;
