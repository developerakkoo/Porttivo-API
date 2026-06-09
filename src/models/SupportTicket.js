const mongoose = require('mongoose');
const { ALL_CODES } = require('../constants/supportTicketCategories');

const REQUESTER_TYPES = Object.freeze(['transporter', 'customer']);

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
    requesterType: {
      type: String,
      enum: REQUESTER_TYPES,
      default: 'transporter',
      index: true,
    },
    requesterModel: {
      type: String,
      enum: ['Transporter', 'Customer'],
      default: 'Transporter',
    },
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'requesterModel',
      default: null,
      index: true,
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
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
      enum: ['', ...ALL_CODES],
      index: true,
    },
    categoryDetail: {
      type: String,
      trim: true,
      default: '',
      maxlength: 200,
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
    unreadByRequester: {
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
supportTicketSchema.index({ requesterType: 1, requesterId: 1, updatedAt: -1 });
supportTicketSchema.index({ status: 1, updatedAt: -1 });
supportTicketSchema.index({ category: 1, updatedAt: -1 });

supportTicketSchema.pre('validate', function normalizeRequester() {
  if (!this.requesterType) {
    this.requesterType = 'transporter';
  }

  if (this.requesterType === 'customer') {
    this.requesterModel = 'Customer';
    if (!this.requesterId && this.transporterId) {
      this.requesterId = this.transporterId;
    }
    if (!this.transporterId) {
      this.transporterId = null;
    }
    return;
  }

  this.requesterModel = 'Transporter';
  if (!this.requesterId && this.transporterId) {
    this.requesterId = this.transporterId;
  }
  if (!this.transporterId && this.requesterId) {
    this.transporterId = this.requesterId;
  }
});

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
