const Notification = require('../models/Notification');

/**
 * Get user notifications
 * GET /api/notifications
 */
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, read, type } = req.query;
    const userId = req.user.id;
    const userType = req.user.userType.toUpperCase();

    const query = { userId, userType };
    if (read !== undefined) query.read = read === 'true';
    if (type) query.type = type;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({ userId, userType, read: false });

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
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

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
 */
const markAllAsRead = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const userType = req.user.userType.toUpperCase();

    const result = await Notification.updateMany(
      { userId, userType, read: false },
      { $set: { read: true, readAt: new Date() } }
    );

    return res.status(200).json({
      success: true,
      message: `${result.modifiedCount} notifications marked as read`,
      data: {
        modifiedCount: result.modifiedCount,
      },
    });
  } catch (error) {
    next(error);
  }
};

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
  markAsRead,
  markAllAsRead,
  sendNotification,
};
