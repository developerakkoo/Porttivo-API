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
      enum: ['transporter', 'admin', 'system'],
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    messageType: {
      type: String,
      enum: [
        'TEXT',
        'ATTACHMENT',
        'SYSTEM_STATUS',
        'SYSTEM_RATING_THANKS',
      ],
      default: 'TEXT',
    },
    content: {
      type: String,
      trim: true,
      default: '',
    },
    systemMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
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

supportMessageSchema.pre('validate', function validateSender(next) {
  if (this.senderType === 'system') {
    this.senderId = undefined;
    if (!['SYSTEM_STATUS', 'SYSTEM_RATING_THANKS'].includes(this.messageType)) {
      this.messageType = 'SYSTEM_STATUS';
    }
  } else if (!this.senderId) {
    return next(new Error('senderId is required for non-system messages'));
  }
  return next();
});

supportMessageSchema.index({ ticketId: 1, createdAt: -1 });
supportMessageSchema.index({ ticketId: 1, status: 1 });

module.exports = mongoose.model('SupportMessage', supportMessageSchema);
