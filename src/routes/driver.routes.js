const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getProfile,
  updateProfile,
  updateLanguage,
  getDriversByTransporter,
  createDriver,
  updateDriver,
  deleteDriver,
  getActiveTrip,
  getQueuedTrips,
  getTripHistory,
} = require('../controllers/driver.controller');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/drivers/profile
 * @desc    Get driver profile
 * @access  Private (Driver only)
 */
router.get('/profile', (req, res, next) => {
  if (req.user.userType !== 'driver') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for drivers only.',
    });
  }
  next();
}, getProfile);

/**
 * @route   PUT /api/drivers/profile
 * @desc    Update driver profile
 * @access  Private (Driver only)
 */
router.put('/profile', (req, res, next) => {
  if (req.user.userType !== 'driver') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for drivers only.',
    });
  }
  next();
}, updateProfile);

/**
 * @route   PUT /api/drivers/language
 * @desc    Update driver language preference
 * @access  Private (Driver only)
 */
router.put('/language', (req, res, next) => {
  if (req.user.userType !== 'driver') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for drivers only.',
    });
  }
  next();
}, updateLanguage);

/**
 * @route   GET /api/drivers/transporter/:transporterId
 * @desc    Get drivers by transporter (Transporter only)
 * @access  Private (Transporter only)
 */
router.get('/transporter/:transporterId', getDriversByTransporter);

/**
 * @route   POST /api/drivers
 * @desc    Create driver (Transporter only)
 * @access  Private (Transporter only)
 */
router.post('/', (req, res, next) => {
  if (req.user.userType !== 'transporter') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for transporters only.',
    });
  }
  next();
}, createDriver);

/**
 * @route   PUT /api/drivers/:id
 * @desc    Update driver (Transporter only)
 * @access  Private (Transporter only)
 */
router.put('/:id', (req, res, next) => {
  if (req.user.userType !== 'transporter') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for transporters only.',
    });
  }
  next();
}, updateDriver);

/**
 * @route   DELETE /api/drivers/:id
 * @desc    Delete driver (Transporter only)
 * @access  Private (Transporter only)
 */
router.delete('/:id', (req, res, next) => {
  if (req.user.userType !== 'transporter') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for transporters only.',
    });
  }
  next();
}, deleteDriver);

/**
 * @route   GET /api/drivers/trips/active
 * @desc    Get active trip for driver
 * @access  Private (Driver only)
 */
router.get('/trips/active', (req, res, next) => {
  if (req.user.userType !== 'driver') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for drivers only.',
    });
  }
  next();
}, getActiveTrip);

/**
 * @route   GET /api/drivers/trips/queued
 * @desc    Get queued trips for driver
 * @access  Private (Driver only)
 */
router.get('/trips/queued', (req, res, next) => {
  if (req.user.userType !== 'driver') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for drivers only.',
    });
  }
  next();
}, getQueuedTrips);

/**
 * @route   GET /api/drivers/trips/history
 * @desc    Get trip history for driver
 * @access  Private (Driver only)
 */
router.get('/trips/history', (req, res, next) => {
  if (req.user.userType !== 'driver') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for drivers only.',
    });
  }
  next();
}, getTripHistory);

module.exports = router;
