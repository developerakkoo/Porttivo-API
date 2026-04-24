const VehicleBooking = require('../models/VehicleBooking');

/**
 * Middleware to verify user is participant in booking
 */
const isBookingParticipant = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Booking ID is required' });
    }

    const booking = await VehicleBooking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const isBuyer = booking.buyerId.toString() === userId;
    const isSeller = booking.sellerId.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this booking. Only buyer or seller can access.',
      });
    }

    // Attach booking to request for later use
    req.booking = booking;
    req.isBuyer = isBuyer;
    req.isSeller = isSeller;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to verify booking exists and validate access
 */
const validateBookingAccess = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!id) {
      return res.status(400).json({ success: false, message: 'Booking ID is required' });
    }

    const booking = await VehicleBooking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    // For privacy: only buyer or seller can view
    const isBuyer = booking.buyerId.toString() === userId;
    const isSeller = booking.sellerId.toString() === userId;

    if (!isBuyer && !isSeller) {
      // Don't reveal that booking exists
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    req.booking = booking;
    req.isBuyer = isBuyer;
    req.isSeller = isSeller;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware to validate status transitions
 * Valid transitions:
 * REQUESTED -> NEGOTIATING (via propose price)
 * REQUESTED -> CONFIRMED (via accept)
 * REQUESTED -> REJECTED (via reject)
 * REQUESTED -> CANCELLED (via cancel)
 * NEGOTIATING -> CONFIRMED (via accept)
 * NEGOTIATING -> REJECTED (via reject)
 * NEGOTIATING -> CANCELLED (via cancel)
 * CONFIRMED -> COMPLETED (via completion)
 */
const validateStatusTransition = (fromStatus, toStatus) => {
  const validTransitions = {
    REQUESTED: ['NEGOTIATING', 'CONFIRMED', 'REJECTED', 'CANCELLED'],
    NEGOTIATING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
    CONFIRMED: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
    REJECTED: [],
  };

  return validTransitions[fromStatus]?.includes(toStatus) || false;
};

/**
 * Check if seller can accept booking
 */
const canSellerAccept = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const booking = await VehicleBooking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.sellerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle seller can perform this action',
      });
    }

    if (!['REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot accept booking in ${booking.status} status`,
      });
    }

    req.booking = booking;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Check if buyer can cancel booking
 */
const canBuyerCancel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const booking = await VehicleBooking.findById(id);

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (booking.buyerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the booking buyer can cancel',
      });
    }

    if (!['REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel booking in ${booking.status} status`,
      });
    }

    req.booking = booking;
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  isBookingParticipant,
  validateBookingAccess,
  validateStatusTransition,
  canSellerAccept,
  canBuyerCancel,
};
