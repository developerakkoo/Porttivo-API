const express = require('express');
const router = express.Router();
const { sendOTP, register, registerPumpOwner, pinLogin, companyUserLogin, refreshToken } = require('../controllers/auth.controller');
const { adminLogin } = require('../controllers/admin.controller');

/**
 * @route   POST /api/auth/register
 * @desc    Register new transporter
 * @access  Public
 */
router.post('/register', register);

/**
 * @route   POST /api/auth/register-pump-owner
 * @desc    Register new pump owner
 * @access  Public
 */
router.post('/register-pump-owner', registerPumpOwner);

/**
 * @route   POST /api/auth/send-otp
 * @desc    Send OTP (simplified - returns tokens directly)
 * @access  Public
 */
router.post('/send-otp', sendOTP);

/**
 * @route   POST /api/auth/pin-login
 * @desc    PIN-based login (Transporter only)
 * @access  Public
 */
router.post('/pin-login', pinLogin);

/**
 * @route   POST /api/auth/company-user-login
 * @desc    Company user PIN-based login
 * @access  Public
 */
router.post('/company-user-login', companyUserLogin);

/**
 * @route   POST /api/auth/admin-login
 * @desc    Admin email/password login
 * @access  Public
 */
router.post('/admin-login', adminLogin);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh', refreshToken);

module.exports = router;
