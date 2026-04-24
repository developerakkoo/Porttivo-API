const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  createBooking,
  getBooking,
  getMyBookings,
  proposePriceOffer,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  submitBooking,
  getBookingStats,
} = require('../controllers/vehicleBooking.controller');

// All endpoints require authentication
router.use(authenticate);

/**
 * @route   POST /api/vehicle-bookings
 * @desc    Create a booking request for a vehicle
 * @access  Private (Transporter only)
 */
router.post('/', createBooking);

/**
 * @route   GET /api/vehicle-bookings/my-bookings
 * @desc    Get all bookings for authenticated transporter (as buyer or seller)
 * @access  Private (Transporter only)
 */
router.get('/my-bookings', getMyBookings);

/**
 * @route   GET /api/vehicle-bookings/stats
 * @desc    Get booking statistics for authenticated transporter
 * @access  Private (Transporter only)
 */
router.get('/stats', getBookingStats);

/**
 * @route   PUT /api/vehicle-bookings/:id/submit
 * @desc    Submit booking request formally after price negotiation (from DRAFT to REQUESTED)
 * @access  Private (Transporter only - buyer only)
 */
router.put('/:id/submit', submitBooking);

/**
 * @route   GET /api/vehicle-bookings/:id
 * @desc    Get single booking details
 * @access  Private (Transporter only - only buyer or seller can view)
 */
router.get('/:id', getBooking);

/**
 * @route   PUT /api/vehicle-bookings/:id/propose-price
 * @desc    Propose a price offer for the booking (starts negotiation)
 * @access  Private (Transporter only - buyer or seller)
 */
router.put('/:id/propose-price', proposePriceOffer);

/**
 * @route   PUT /api/vehicle-bookings/:id/accept
 * @desc    Accept/confirm booking (seller only)
 * @access  Private (Transporter only - seller)
 */
router.put('/:id/accept', acceptBooking);

/**
 * @route   PUT /api/vehicle-bookings/:id/reject
 * @desc    Reject booking (seller only)
 * @access  Private (Transporter only - seller)
 */
router.put('/:id/reject', rejectBooking);

/**
 * @route   DELETE /api/vehicle-bookings/:id
 * @desc    Cancel booking (buyer only, before confirmation)
 * @access  Private (Transporter only - buyer)
 */
router.delete('/:id', cancelBooking);

module.exports = router;
