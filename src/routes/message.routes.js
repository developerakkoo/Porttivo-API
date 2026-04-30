const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  sendMessage,
  getConversation,
  markBookingReadAll,
  markAsRead,
  getUnreadCount,
  deleteMessage,
  searchMessages,
} = require('../controllers/transporterMessage.controller');

// All endpoints require authentication
router.use(authenticate);

/**
 * @route   POST /api/messages
 * @desc    Send a message in a booking conversation
 * @access  Private (Transporter only - must be buyer or seller in booking)
 */
router.post('/', sendMessage);

/**
 * @route   GET /api/messages/unread-count
 * @desc    Get total unread message count for authenticated user
 * @access  Private (Transporter only)
 */
router.get('/unread-count', getUnreadCount);

/**
 * @route   POST /api/messages/booking/:bookingId/read-all
 * @desc    Mark all messages in booking as read for current user
 * @access  Private (Transporter only)
 */
router.post('/booking/:bookingId/read-all', markBookingReadAll);

/**
 * @route   GET /api/messages/booking/:bookingId
 * @desc    Get all messages for a specific booking (conversation)
 * @access  Private (Transporter only - only buyer or seller can view)
 */
router.get('/booking/:bookingId', getConversation);

/**
 * @route   GET /api/messages/search/:bookingId
 * @desc    Search messages in a booking
 * @access  Private (Transporter only - only buyer or seller)
 */
router.get('/search/:bookingId', searchMessages);

/**
 * @route   PUT /api/messages/:messageId/read
 * @desc    Mark a message as read
 * @access  Private (Transporter only - receiver only)
 */
router.put('/:messageId/read', markAsRead);

/**
 * @route   DELETE /api/messages/:messageId
 * @desc    Delete a message (soft delete, only within 5 minutes)
 * @access  Private (Transporter only - sender only)
 */
router.delete('/:messageId', deleteMessage);

module.exports = router;
