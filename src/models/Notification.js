const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'User ID is required'],
      index: true,
    },
    userType: {
      type: String,
      enum: ['TRANSPORTER', 'DRIVER', 'PUMP_OWNER', 'PUMP_STAFF', 'ADMIN'],
      required: [true, 'User type is required'],
      index: true,
    },
    type: {
      type: String,
      enum: [
        'TRIP_STARTED',
        'TRIP_COMPLETED',
        'TRIP_ASSIGNED',
        'MILESTONE_COMPLETED',
        'POD_UPLOADED',
        'FUEL_TRANSACTION',
        'SETTLEMENT',
        'WALLET',
        'SYSTEM',
        'FRAUD_ALERT',
        'OTHER',
      ],
      required: [true, 'Notification type is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    message: {
      type: String,
      required: [true, 'Message is required'],
      trim: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
notificationSchema.index({ userId: 1, userType: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, userType: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });

// Method to mark as read
notificationSchema.methods.markAsRead = function () {
  this.read = true;
  this.readAt = new Date();
  return this.save();
};

module.exports = mongoose.model('Notification', notificationSchema);
