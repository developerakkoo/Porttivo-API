const TransporterMessage = require('../models/TransporterMessage');
const VehicleBooking = require('../models/VehicleBooking');
const { getIO } = require('../services/socket.service');
const mongoose = require('mongoose');

/**
 * Send a message in booking conversation
 * POST /api/messages
 */
const sendMessage = async (req, res, next) => {
  try {
    const senderId = req.user?.id;
    if (!senderId) {
      return res.status(403).json({ success: false, message: 'Only authenticated users can send messages' });
    }

    const { bookingId, content, messageType } = req.body;

    if (!bookingId || !content || !content.trim()) {
      return res.status(400).json({ success: false, message: 'bookingId and content are required' });
    }

    // Validate booking exists and user is participant
    const booking = await VehicleBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const isBuyer = booking.buyerId.toString() === senderId;
    const isSeller = booking.sellerId.toString() === senderId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'You do not have access to this booking' });
    }

    // Determine receiver
    const receiverId = isBuyer ? booking.sellerId : booking.buyerId;

    // Create message
    const message = await TransporterMessage.create({
      bookingId,
      senderId,
      receiverId,
      content: content.trim(),
      messageType: messageType || 'TEXT',
      status: 'SENT',
    });

    // Mark as delivered immediately
    message.status = 'DELIVERED';
    await message.save();

    // Populate for response
    const populatedMessage = await TransporterMessage.findById(message._id)
      .populate('senderId', 'name mobile company')
      .populate('receiverId', 'name mobile')
      .lean();

    // Emit socket event to receiver
    try {
      const io = getIO();
      io.to(`transporter:${receiverId}`).emit('message:new', {
        bookingId,
        message: populatedMessage,
      });
    } catch (err) {
      console.warn('Socket emit failed (message:new):', err.message || err);
    }

    return res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: { message: populatedMessage },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get conversation (all messages for a booking)
 * GET /api/messages/booking/:bookingId
 */
const getConversation = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user?.id;
    const { page = 1, limit = 50 } = req.query;

    // Validate booking exists and user is participant
    const booking = await VehicleBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const isBuyer = booking.buyerId.toString() === userId;
    const isSeller = booking.sellerId.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'You do not have access to this booking' });
    }

    // Calculate pagination
    const skip = (Number(page) - 1) * Number(limit);

    // Get messages
    const messages = await TransporterMessage.find({ bookingId })
      .populate('senderId', 'name mobile company')
      .populate('receiverId', 'name mobile')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    // Mark all unread messages from the other party as read
    const otherPartyId = isBuyer ? booking.sellerId : booking.buyerId;
    const unreadMessages = await TransporterMessage.updateMany(
      {
        bookingId,
        receiverId: userId,
        status: { $ne: 'READ' },
      },
      {
        status: 'READ',
        readAt: new Date(),
      }
    );

    // Get total count
    const total = await TransporterMessage.countDocuments({ bookingId });

    // Get unread count for this conversation
    const unreadCount = await TransporterMessage.countDocuments({
      bookingId,
      receiverId: userId,
      status: { $ne: 'READ' },
    });

    return res.status(200).json({
      success: true,
      data: {
        messages,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
        unreadCount,
        otherParty: {
          id: otherPartyId,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark message as read
 * PUT /api/messages/:messageId/read
 */
const markAsRead = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.id;

    const message = await TransporterMessage.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Only receiver can mark as read
    if (message.receiverId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'You cannot mark this message as read' });
    }

    if (message.status === 'READ') {
      return res.status(200).json({
        success: true,
        message: 'Message already read',
        data: { message },
      });
    }

    message.status = 'READ';
    message.readAt = new Date();
    await message.save();

    // Emit socket event to sender
    try {
      const io = getIO();
      io.to(`transporter:${message.senderId}`).emit('message:read', {
        messageId: message._id,
        readAt: message.readAt,
      });
    } catch (err) {
      console.warn('Socket emit failed (message:read):', err.message || err);
    }

    return res.status(200).json({
      success: true,
      message: 'Message marked as read',
      data: { message },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get unread message count for current user
 * GET /api/messages/unread-count
 */
const getUnreadCount = async (req, res, next) => {
  try {
    const userId = req.user?.id;

    // Get total unread messages
    const totalUnread = await TransporterMessage.countDocuments({
      receiverId: userId,
      status: { $ne: 'READ' },
    });

    // Get unread messages grouped by booking
    const unreadByBooking = await TransporterMessage.aggregate([
      {
        $match: {
          receiverId: mongoose.Types.ObjectId(userId),
          status: { $ne: 'READ' },
        },
      },
      {
        $group: {
          _id: '$bookingId',
          count: { $sum: 1 },
        },
      },
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalUnread,
        byBooking: unreadByBooking.map((item) => ({
          bookingId: item._id,
          unreadCount: item.count,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete a message (soft delete by user - just mark as deleted)
 * DELETE /api/messages/:messageId
 */
const deleteMessage = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user?.id;

    const message = await TransporterMessage.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

    // Only sender can delete their own message
    if (message.senderId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'You can only delete your own messages' });
    }

    // Only delete if within 5 minutes of sending
    const timeDifference = new Date() - new Date(message.createdAt);
    if (timeDifference > 5 * 60 * 1000) {
      return res.status(400).json({ success: false, message: 'Message can only be deleted within 5 minutes of sending' });
    }

    // Mark as deleted by updating content
    message.content = '[Message deleted]';
    await message.save();

    return res.status(200).json({
      success: true,
      message: 'Message deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Search messages in a booking
 * GET /api/messages/search/:bookingId
 */
const searchMessages = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user?.id;
    const { query, messageType } = req.query;

    // Validate booking and access
    const booking = await VehicleBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const isBuyer = booking.buyerId.toString() === userId;
    const isSeller = booking.sellerId.toString() === userId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'You do not have access to this booking' });
    }

    // Build search query
    const searchQuery = { bookingId };

    if (query && query.trim()) {
      searchQuery.content = { $regex: query.trim(), $options: 'i' };
    }

    if (messageType) {
      searchQuery.messageType = messageType;
    }

    const messages = await TransporterMessage.find(searchQuery)
      .populate('senderId', 'name mobile')
      .populate('receiverId', 'name mobile')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        messages,
        total: messages.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  sendMessage,
  getConversation,
  markAsRead,
  getUnreadCount,
  deleteMessage,
  searchMessages,
};
