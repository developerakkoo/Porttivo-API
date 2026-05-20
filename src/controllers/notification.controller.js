const Notification = require('../models/Notification');

/**
 * Get user notifications
 * GET /api/notifications
 * Query: page, limit (max 100), read, type (single), types (comma-separated, overrides type)
 */
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, read, type, types: typesQ } = req.query
    let limit = parseInt(req.query.limit, 10) || 20
    if (limit > 100) limit = 100
    if (limit < 1) limit = 20

    const userId = req.user.id
    const userType = req.user.userType.toUpperCase()

    const query = { userId, userType }
    if (read !== undefined) query.read = read === 'true'
    if (typesQ) {
      const arr = String(typesQ)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (arr.length) query.type = { $in: arr }
    } else if (type) {
      query.type = type
    }

    const skip = (parseInt(page, 10) - 1) * limit

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)

    const total = await Notification.countDocuments(query)
    const unreadFilter = { userId, userType, read: false }
    if (query.type) unreadFilter.type = query.type
    const unreadCount = await Notification.countDocuments(unreadFilter)

    return res.status(200).json({
      success: true,
      message: 'Notifications retrieved successfully',
      data: {
        notifications: notifications.map((n) => ({
          id: n._id,
          type: n.type,
          title: n.title,
          message: n.message,
          data: n.data,
          read: n.read,
          readAt: n.readAt,
          priority: n.priority,
          createdAt: n.createdAt,
        })),
        unreadCount,
        pagination: {
          page: parseInt(page, 10),
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * GET /api/notifications/unread-summary
 * Unread counts for selected types (default: support-related types).
 */
const getUnreadSummary = async (req, res, next) => {
  try {
    const userId = req.user.id
    const userType = req.user.userType.toUpperCase()
    const defaultTypes = [
      'SUPPORT_TICKET_CREATED',
      'SUPPORT_MESSAGE',
      'SUPPORT_STATUS_CHANGED',
    ]
    let types = defaultTypes
    if (req.query.types) {
      const arr = String(req.query.types)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (arr.length) types = arr
    }
    const unreadCount = await Notification.countDocuments({
      userId,
      userType,
      read: false,
      type: { $in: types },
    })
    return res.status(200).json({
      success: true,
      data: { unreadCount, types },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Mark notification as read
 * PUT /api/notifications/:id/read
 */
const markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userType = req.user.userType.toUpperCase();

    const notification = await Notification.findOne({ _id: id, userId, userType });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found',
      });
    }

    await notification.markAsRead();

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      data: {
        notification: {
          id: notification._id,
          read: notification.read,
          readAt: notification.readAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark all notifications as read
 * PUT /api/notifications/read-all
 * Optional query: types=comma-separated or type=single (limit which unread rows are updated)
 */
const markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id
    const userType = req.user.userType.toUpperCase()

    const filter = { userId, userType, read: false }
    if (req.query.types) {
      const arr = String(req.query.types)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      if (arr.length) filter.type = { $in: arr }
    } else if (req.query.type) {
      filter.type = req.query.type
    }

    const result = await Notification.updateMany(filter, {
      $set: { read: true, readAt: new Date() },
    })

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      data: {
        modifiedCount: result.modifiedCount,
      },
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Send notification (Admin/System only)
 * POST /api/notifications/send
 */
const sendNotification = async (req, res, next) => {
  try {
    // Only admin or system can send notifications
    if (req.user.userType !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Admin only.',
      });
    }

    const { userId, userType, type, title, message, data, priority } = req.body;

    if (!userId || !userType || !type || !title || !message) {
      return res.status(400).json({
        success: false,
        message: 'userId, userType, type, title, and message are required',
      });
    }

    const notification = new Notification({
      userId,
      userType: userType.toUpperCase(),
      type,
      title,
      message,
      data: data || {},
      priority: priority || 'medium',
    });

    await notification.save();

    return res.status(201).json({
      success: true,
      message: 'Notification sent successfully',
      data: {
        notification: {
          id: notification._id,
          type: notification.type,
          title: notification.title,
          message: notification.message,
          createdAt: notification.createdAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNotifications,
  getUnreadSummary,
  markAsRead,
  markAllAsRead,
  sendNotification,
}
