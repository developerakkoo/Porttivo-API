const mongoose = require('mongoose');

const supportMessageSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    senderType: {
      type: String,
      enum: ['transporter', 'admin'],
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    messageType: {
      type: String,
      enum: ['TEXT', 'ATTACHMENT'],
      default: 'TEXT',
    },
    content: {
      type: String,
      trim: true,
      default: '',
    },
    attachments: [{ type: mongoose.Schema.Types.Mixed }],
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
  },
  { timestamps: true }
);

supportMessageSchema.index({ ticketId: 1, createdAt: -1 });
supportMessageSchema.index({ ticketId: 1, status: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
