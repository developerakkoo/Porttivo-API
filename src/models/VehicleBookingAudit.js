const mongoose = require('mongoose');

const vehicleBookingAuditSchema = new mongoose.Schema(
  {
    // Reference to booking
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleBooking',
      required: true,
      index: true,
    },

    // Action performed
    action: {
      type: String,
      enum: [
        'CREATED',
        'PRICE_PROPOSED',
        'PRICE_ACCEPTED',
        'CONFIRMED',
        'REJECTED',
        'CANCELLED',
        'COMPLETED',
        'STATUS_CHANGED',
      ],
      required: true,
      index: true,
    },

    // Who performed the action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },

    // Detailed information about the action
    details: {
      type: Object,
      default: {},
    },

    // Old and new values (for tracking changes)
    beforeValue: {
      type: Object,
      default: null,
    },
    afterValue: {
      type: Object,
      default: null,
    },

    // Additional notes
    notes: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true }
);

// Indexes
vehicleBookingAuditSchema.index({ bookingId: 1, createdAt: -1 });
vehicleBookingAuditSchema.index({ performedBy: 1, createdAt: -1 });
vehicleBookingAuditSchema.index({ action: 1, createdAt: -1 });
vehicleBookingAuditSchema.index({ createdAt: -1 });

module.exports = mongoose.model('VehicleBookingAudit', vehicleBookingAuditSchema);
