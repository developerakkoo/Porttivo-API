const mongoose = require('mongoose');

// 🔥 Centralized constants (prevents typo bugs)
const BOOKING_AUDIT_ACTIONS = {
  INQUIRY_CREATED: 'INQUIRY_CREATED',       // DRAFT created
  PRICE_PROPOSED: 'PRICE_PROPOSED',         // negotiation
  PRICE_ACCEPTED: 'PRICE_ACCEPTED',
  BOOKING_SUBMITTED: 'BOOKING_SUBMITTED',   // DRAFT → REQUESTED
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  STATUS_CHANGED: 'STATUS_CHANGED',
};

const vehicleBookingAuditSchema = new mongoose.Schema(
  {
    // 🔗 Booking reference
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleBooking',
      required: true,
      index: true,
    },

    // 🎯 Action type
    action: {
      type: String,
      enum: Object.values(BOOKING_AUDIT_ACTIONS),
      required: true,
      index: true,
    },

    // 👤 Who performed action
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },

    // 🧾 Extra metadata (flexible)
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // 🔄 Before & After (for tracking changes)
    beforeValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    afterValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // 📝 Optional notes
    notes: {
      type: String,
      trim: true,
      default: null,
    },

    // 📡 Optional: source of action (API / SOCKET / SYSTEM)
    source: {
      type: String,
      enum: ['API', 'SOCKET', 'SYSTEM'],
      default: 'API',
    },
  },
  {
    timestamps: true,
  }
);


// 🚀 INDEXES (VERY IMPORTANT FOR SCALE)

// Booking timeline queries
vehicleBookingAuditSchema.index({ bookingId: 1, createdAt: -1 });

// User activity tracking
vehicleBookingAuditSchema.index({ performedBy: 1, createdAt: -1 });

// Action filtering
vehicleBookingAuditSchema.index({ action: 1, createdAt: -1 });

// Combined query optimization
vehicleBookingAuditSchema.index({ bookingId: 1, action: 1 });


// 🧠 STATIC HELPER (CLEAN USAGE)
vehicleBookingAuditSchema.statics.logAction = async function ({
  bookingId,
  action,
  performedBy,
  details = {},
  beforeValue = null,
  afterValue = null,
  notes = null,
  source = 'API',
}) {
  return this.create({
    bookingId,
    action,
    performedBy,
    details,
    beforeValue,
    afterValue,
    notes,
    source,
  });
};


// 🚀 EXPORT CONSTANTS + MODEL
module.exports = {
  VehicleBookingAudit: mongoose.model(
    'VehicleBookingAudit',
    vehicleBookingAuditSchema
  ),
  BOOKING_AUDIT_ACTIONS,
};