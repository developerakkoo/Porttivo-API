const TransporterMessage = require('../models/TransporterMessage');
const VehicleBooking = require('../models/VehicleBooking');
const Notification = require('../models/Notification');
const { getIO } = require('../services/socket.service');
const mongoose = require('mongoose');
const { getTransporterActorId } = require('../utils/transporterActor');
const { buildChatMessageSocketPayload } = require('../utils/marketplaceChatPayload');
const {
  buildMarketplaceMessageNotificationFields
} = require('../utils/marketplaceNotification');
const {
  MAX_CHAT_ATTACHMENTS,
  normalizeAttachmentsInput,
  bookingAllowsParticipantChat,
  effectiveChatMessageType
} = require('../utils/marketplaceChatAttachments');

/**
 * Send a message in booking conversation
 * POST /api/messages
 */
const sendMessage = async (req, res, next) => {
  try {
    const senderId = getTransporterActorId(req.user);
    if (!senderId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can send messages' });
    }

    const { bookingId, content, messageType, proposedPrice, attachments: attachmentsRaw } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }

    const booking = await VehicleBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    if (!bookingAllowsParticipantChat(booking)) {
      return res.status(403).json({ success: false, message: 'Chat is closed for this booking' });
    }

    const isBuyer = booking.buyerId.toString() === senderId;
    const isSeller = booking.sellerId.toString() === senderId;

    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'You do not have access to this booking' });
    }

    const attachments = normalizeAttachmentsInput(attachmentsRaw);
    if (attachments.length > MAX_CHAT_ATTACHMENTS) {
      return res.status(400).json({
        success: false,
        message: `At most ${MAX_CHAT_ATTACHMENTS} attachments per message`,
      });
    }

    const contentTrim = content != null ? String(content).trim() : '';
    if (!contentTrim && attachments.length === 0) {
      return res.status(400).json({ success: false, message: 'content or attachments required' });
    }

    if (attachments.length > 0 && contentTrim.length > 2000) {
      return res.status(400).json({ success: false, message: 'Caption too long (max 2000)' });
    }

    if (attachments.length > 0 && proposedPrice != null && proposedPrice !== '') {
      return res.status(400).json({ success: false, message: 'Attachments cannot be combined with price proposals' });
    }

    const textForLengthCheck = attachments.length > 0 ? contentTrim : contentTrim;
    if (attachments.length === 0 && textForLengthCheck.length > 2000) {
      return res.status(400).json({ success: false, message: 'Message too long' });
    }

    const receiverId = isBuyer ? booking.sellerId : booking.buyerId;

    const effectiveType = effectiveChatMessageType(
      contentTrim,
      attachments,
      messageType,
      proposedPrice
    );

    const message = await TransporterMessage.create({
      bookingId,
      senderId,
      receiverId,
      content: attachments.length > 0 ? contentTrim : contentTrim,
      messageType: effectiveType,
      proposedPrice: proposedPrice != null ? proposedPrice : null,
      status: 'DELIVERED',
      attachments,
    });

    const populatedMessage = await TransporterMessage.findById(message._id)
      .populate('senderId', 'name mobile company')
      .populate('receiverId', 'name mobile')
      .lean();

    try {
      const io = getIO();
      const payload = buildChatMessageSocketPayload(
        bookingId,
        populatedMessage,
        senderId
      );
      io.to(`chat:${bookingId}`).emit('chat:message:new', payload);
      io.to(`transporter:${receiverId}`).emit('chat:message:new', payload);
      io.to(`transporter:${receiverId}`).emit('message:new', payload);
    } catch (err) {
      console.warn('Socket emit failed (chat:message:new):', err.message || err);
    }

    try {
      const notif = buildMarketplaceMessageNotificationFields({
        bookingId,
        populatedMessageLean: populatedMessage
      });
      await Notification.create({
        userId: receiverId,
        userType: 'TRANSPORTER',
        type: 'MARKETPLACE_MESSAGE',
        title: notif.title,
        message: notif.message,
        data: notif.data
      });
    } catch (err) {
      console.warn('Marketplace notification skipped:', err.message || err);
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
 * POST /api/messages/upload — multipart field "files" (max 5), form field bookingId
 */
const uploadChatAttachments = async (req, res, next) => {
  try {
    const senderId = getTransporterActorId(req.user);
    if (!senderId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can upload' });
    }
    const bookingId = req.body.bookingId;
    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }
    const booking = await VehicleBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }
    if (!bookingAllowsParticipantChat(booking)) {
      return res.status(403).json({ success: false, message: 'Chat is closed for this booking' });
    }
    const isBuyer = booking.buyerId.toString() === senderId;
    const isSeller = booking.sellerId.toString() === senderId;
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'You do not have access to this booking' });
    }
    const files = req.files || [];
    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, message: 'No files uploaded' });
    }
    const attachments = files.map((f) => ({
      url: `/uploads/chat/${f.filename}`,
      mimeType: f.mimetype,
      originalName: f.originalname || null,
      sizeBytes: f.size != null ? f.size : null,
    }));
    return res.status(200).json({
      success: true,
      data: { attachments },
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
    const userId = getTransporterActorId(req.user);
    if (!userId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can view messages' });
    }
    const { page = 1, limit = 50, afterCreatedAt, afterMessageId } = req.query;

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

    const otherPartyId = isBuyer ? booking.sellerId : booking.buyerId;

    await TransporterMessage.updateMany(
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

    const messageFilter = { bookingId };
    let incremental = false;
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);

    if (afterMessageId && mongoose.Types.ObjectId.isValid(afterMessageId)) {
      const anchor = await TransporterMessage.findById(afterMessageId)
        .select('bookingId createdAt')
        .lean();
      if (!anchor || anchor.bookingId.toString() !== bookingId) {
        return res.status(400).json({
          success: false,
          message: 'afterMessageId does not belong to this booking',
        });
      }
      messageFilter.createdAt = { $gt: anchor.createdAt };
      incremental = true;
    } else if (afterCreatedAt) {
      const d = new Date(afterCreatedAt);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid afterCreatedAt',
        });
      }
      messageFilter.createdAt = { $gt: d };
      incremental = true;
    }

    let messages;
    if (incremental) {
      messages = await TransporterMessage.find(messageFilter)
        .populate('senderId', 'name mobile company')
        .populate('receiverId', 'name mobile')
        .sort({ createdAt: 1 })
        .limit(lim)
        .lean();
    } else {
      const skip = (Number(page) - 1) * lim;
      messages = await TransporterMessage.find(messageFilter)
        .populate('senderId', 'name mobile company')
        .populate('receiverId', 'name mobile')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(lim)
        .lean();
    }

    const total = await TransporterMessage.countDocuments({ bookingId });

    const unreadCount = await TransporterMessage.countDocuments({
      bookingId,
      receiverId: userId,
      status: { $ne: 'READ' },
    });

    return res.status(200).json({
      success: true,
      data: {
        messages,
        incremental,
        pagination: incremental
          ? null
          : {
              page: Number(page),
              limit: lim,
              total,
              pages: Math.ceil(total / lim),
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
 * Mark all messages in a booking as read for the current user
 * POST /api/messages/booking/:bookingId/read-all
 */
const markBookingReadAll = async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = getTransporterActorId(req.user);
    if (!userId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can mark messages read' });
    }

    const booking = await VehicleBooking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found' });
    }

    const isBuyer = booking.buyerId.toString() === userId;
    const isSeller = booking.sellerId.toString() === userId;
    if (!isBuyer && !isSeller) {
      return res.status(403).json({ success: false, message: 'You do not have access to this booking' });
    }

    const now = new Date();
    await TransporterMessage.updateMany(
      {
        bookingId,
        receiverId: userId,
        status: { $ne: 'READ' },
      },
      {
        status: 'READ',
        readAt: now,
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Messages marked as read',
      data: { bookingId },
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
    const userId = getTransporterActorId(req.user);
    if (!userId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can mark messages read' });
    }

    const message = await TransporterMessage.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

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

    try {
      const io = getIO();
      const readPayload = {
        bookingId: message.bookingId,
        messageId: message._id,
        readAt: message.readAt,
      };
      io.to(`chat:${message.bookingId}`).emit('chat:message:read', readPayload);
      io.to(`transporter:${message.senderId}`).emit('chat:message:read', readPayload);
      io.to(`transporter:${message.senderId}`).emit('message:read', readPayload);
    } catch (err) {
      console.warn('Socket emit failed (chat:message:read):', err.message || err);
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
    const userId = getTransporterActorId(req.user);
    if (!userId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can view unread counts' });
    }

    const totalUnread = await TransporterMessage.countDocuments({
      receiverId: userId,
      status: { $ne: 'READ' },
    });

    const unreadByBooking = await TransporterMessage.aggregate([
      {
        $match: {
          receiverId: new mongoose.Types.ObjectId(userId),
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
    const userId = getTransporterActorId(req.user);
    if (!userId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can delete messages' });
    }

    const message = await TransporterMessage.findById(messageId);
    if (!message) {
      return res.status(404).json({ success: false, message: 'Message not found' });
    }

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
    const userId = getTransporterActorId(req.user);
    if (!userId) {
      return res.status(403).json({ success: false, message: 'Only transporter accounts can search messages' });
    }
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
  uploadChatAttachments,
  getConversation,
  markBookingReadAll,
  markAsRead,
  getUnreadCount,
  deleteMessage,
  searchMessages,
};
