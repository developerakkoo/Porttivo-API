const mongoose = require('mongoose');

const vehicleBookingSchema = new mongoose.Schema(
  {
    // References
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleRouteAvailability',
      required: true,
      index: true,
    },
    assignmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleRouteAssignment',
      required: true,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    buyerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },
    sellerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },

    // Booking Status Flow:
    // DRAFT (inquiry created) -> REQUESTED (submitted after negotiation) -> 
    // NEGOTIATING -> CONFIRMED -> COMPLETED
    // Or: DRAFT/REQUESTED/NEGOTIATING -> REJECTED/CANCELLED
    status: {
      type: String,
      enum: ['DRAFT', 'REQUESTED', 'NEGOTIATING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED'],
      default: 'DRAFT',
      index: true,
    },

    // Pricing
    estimatedPrice: {
      type: Number,
      default: null,
      min: 0,
    },
    agreedPrice: {
      type: Number,
      default: null,
      min: 0,
    },

    // Negotiation tracking
    negotiationRound: {
      type: Number,
      default: 0,
    },
    lastPriceProposal: {
      proposedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transporter',
        default: null,
      },
      proposedPrice: {
        type: Number,
        default: null,
      },
      proposedAt: {
        type: Date,
        default: null,
      },
    },

    /** Set when the *receiver* of the latest proposal agrees to that price (buyer must ack seller offers before seller confirms). */
    proposalAcknowledgedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
    },
    proposalAcknowledgedAt: {
      type: Date,
      default: null,
    },

    // Trip Integration
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      default: null,
      index: true,
    },

    // Timestamps for workflow
    submittedAt: {
      type: Date,
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectReason: {
      type: String,
      trim: true,
      default: null,
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },

    // Additional metadata
    note: {
      type: String,
      trim: true,
      default: null,
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'HOLD', 'COMPLETED', 'REFUNDED'],
      default: 'PENDING',
    },
    notificationsSent: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

// Indexes for queries
vehicleBookingSchema.index({ buyerId: 1, status: 1 });
vehicleBookingSchema.index({ sellerId: 1, status: 1 });
vehicleBookingSchema.index({ postId: 1, status: 1 });
vehicleBookingSchema.index({ createdAt: -1 });
vehicleBookingSchema.index({ buyerId: 1, sellerId: 1 });

module.exports = mongoose.model('VehicleBooking', vehicleBookingSchema);
