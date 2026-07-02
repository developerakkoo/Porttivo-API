const mongoose = require('mongoose')

const marketplacePaymentSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
      index: true
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleBooking',
      required: true,
      index: true
    },
    payerTransporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true
    },
    beneficiaryTransporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['PAYU'],
      default: 'PAYU',
      index: true
    },
    status: {
      type: String,
      enum: ['CREATED', 'PENDING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REFUNDED'],
      default: 'CREATED',
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR']
    },
    merchantTransactionId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    providerTransactionId: {
      type: String,
      default: null,
      sparse: true,
      index: true
    },
    providerOrderId: {
      type: String,
      default: null,
      sparse: true,
      index: true
    },
    paymentGatewayUrl: {
      type: String,
      default: null
    },
    paymentRequest: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    paymentResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    callbackPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    failureReason: {
      type: String,
      trim: true,
      default: null
    },
    initiatedBy: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null
      },
      userType: {
        type: String,
        trim: true,
        default: null
      }
    },
    initiatedAt: {
      type: Date,
      default: Date.now
    },
    completedAt: {
      type: Date,
      default: null
    },
    failedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
)

marketplacePaymentSchema.index({ tripId: 1, status: 1 })
marketplacePaymentSchema.index({ bookingId: 1, status: 1 })
marketplacePaymentSchema.index({ provider: 1, merchantTransactionId: 1 })
marketplacePaymentSchema.index({ providerTransactionId: 1 })
marketplacePaymentSchema.index({ createdAt: -1 })

module.exports = mongoose.model('MarketplacePayment', marketplacePaymentSchema)
