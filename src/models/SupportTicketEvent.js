const mongoose = require('mongoose');

const supportTicketEventSchema = new mongoose.Schema(
  {
    ticketId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SupportTicket',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['created', 'status_changed', 'rated'],
      required: true,
    },
    actorType: {
      type: String,
      enum: ['transporter', 'customer', 'admin', 'system'],
      required: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

supportTicketEventSchema.index({ ticketId: 1, createdAt: -1 });

module.exports = mongoose.model('SupportTicketEvent', supportTicketEventSchema);
