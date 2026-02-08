const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { getProfile, updateProfile, setPin, getDashboard } = require('../controllers/transporter.controller');

// All routes require authentication
router.use(authenticate);

// Verify user is a transporter
router.use((req, res, next) => {
  if (req.user.userType !== 'transporter') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for transporters only.',
    });
  }
  next();
});

/**
 * @route   GET /api/transporters/profile
 * @desc    Get transporter profile
 * @access  Private (Transporter only)
 */
router.get('/profile', getProfile);

/**
 * @route   PUT /api/transporters/profile
 * @desc    Update transporter profile
 * @access  Private (Transporter only)
 */
router.put('/profile', updateProfile);

/**
 * @route   PUT /api/transporters/set-pin
 * @desc    Set PIN for transporter
 * @access  Private (Transporter only)
 */
router.put('/set-pin', setPin);

/**
 * @route   GET /api/transporters/dashboard
 * @desc    Get transporter dashboard stats
 * @access  Private (Transporter only)
 */
router.get('/dashboard', getDashboard);

module.exports = router;
