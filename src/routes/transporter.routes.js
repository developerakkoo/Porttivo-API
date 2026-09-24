const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { getProfile, updateProfile, setPin, getDashboard } = require('../controllers/transporter.controller');
const {
  getKycStatus,
  submitOrUpdateKyc,
  uploadSingleKycDoc
} = require('../controllers/transporterKyc.controller');
const {
  uploadKycDocs,
  uploadKycSingle,
  handleMulterError,
} = require('../middleware/upload.middleware');

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

/**
 * @route   GET /api/transporters/kyc
 * @desc    Get transporter KYC details and uploaded documents
 * @access  Private (Transporter only)
 */
router.get('/kyc', getKycStatus);

/**
 * @route   POST /api/transporters/kyc
 * @desc    Submit or update transporter KYC documents
 * @access  Private (Transporter only)
 */
router.post('/kyc', uploadKycDocs, handleMulterError, submitOrUpdateKyc);

/**
 * @route   PUT /api/transporters/kyc
 * @desc    Edit/update transporter KYC documents
 * @access  Private (Transporter only)
 */
router.put('/kyc', uploadKycDocs, handleMulterError, submitOrUpdateKyc);

/**
 * @route   POST /api/transporters/kyc/upload
 * @desc    Upload single KYC document
 * @access  Private (Transporter only)
 */
router.post('/kyc/upload', uploadKycSingle, handleMulterError, uploadSingleKycDoc);

module.exports = router;
