const mongoose = require('mongoose');

const transporterMessageSchema = new mongoose.Schema(
  {
    // Context
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleBooking',
      required: true,
      index: true,
    },

    // Participants
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },

    // Message Content
    messageType: {
      type: String,
      enum: [
        'TEXT',
        'PRICE_PROPOSAL',
        'PRICE_COUNTER',
        'ACCEPTED',
        'REJECTED',
        'SYSTEM',
        'ATTACHMENT'
      ],
      default: 'TEXT',
      index: true,
    },
    content: {
      type: String,
      required: false,
      trim: true,
      default: ''
    },

    // Price proposal (if applicable)
    proposedPrice: {
      type: Number,
      default: null,
      min: 0,
    },

    // Message Status
    status: {
      type: String,
      enum: ['SENT', 'DELIVERED', 'READ'],
      default: 'SENT',
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },

    // Metadata: array of { url, mimeType, originalName?, sizeBytes? } or legacy URL strings
    attachments: [{ type: mongoose.Schema.Types.Mixed }],
  },
  { timestamps: true }
);

// Indexes for performance
transporterMessageSchema.index({ bookingId: 1, createdAt: -1 });
transporterMessageSchema.index({ senderId: 1, receiverId: 1, bookingId: 1 });
transporterMessageSchema.index({ status: 1, createdAt: -1 });
transporterMessageSchema.index({ readAt: 1 });
transporterMessageSchema.index({ receiverId: 1, status: 1 });
transporterMessageSchema.index({ bookingId: 1, status: 1 });

module.exports = mongoose.model('TransporterMessage', transporterMessageSchema);
