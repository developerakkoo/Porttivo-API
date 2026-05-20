const mongoose = require('mongoose');

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    ticketSeq: {
      type: Number,
      required: true,
      unique: true,
      index: true,
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
      index: true,
    },
    status: {
      type: String,
      enum: ['open', 'pending', 'resolved'],
      default: 'open',
      index: true,
    },
    lastMessageAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastMessagePreview: {
      type: String,
      default: '',
    },
    unreadByTransporter: {
      type: Number,
      default: 0,
      min: 0,
    },
    unreadByAdmin: {
      type: Number,
      default: 0,
      min: 0,
    },
    ratingScore: {
      type: Number,
      default: null,
    },
    ratingComment: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
    ratedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
);

supportTicketSchema.index({ transporterId: 1, updatedAt: -1 });
supportTicketSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
