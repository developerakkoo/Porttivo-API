const mongoose = require('mongoose');

/** Atomic sequence for human-readable support ticket numbers (SUP-100000+). */
const supportTicketCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, default: 'support_ticket' },
    seq: { type: Number, default: 100000 },
  },
  { collection: 'supportticketcounters' }
);

module.exports = mongoose.model('SupportTicketCounter', supportTicketCounterSchema);
