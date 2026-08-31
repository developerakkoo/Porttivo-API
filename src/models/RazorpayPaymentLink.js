const mongoose = require('mongoose')

const razorpayPaymentLinkSchema = new mongoose.Schema(
  {
    publicId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
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

    routeAccountId: {
      type: String,
      required: true,
      index: true,
      trim: true
    },

    payerTransporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
      index: true
    },

    businessReferenceType: {
      type: String,
      default: null,
      trim: true
    },

    businessReferenceId: {
      type: String,
      default: null,
      trim: true,
      index: true
    },

    callbackUrl: {
      type: String,
      default: null
    },

    razorpayPaymentLinkId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },

    shortUrl: {
      type: String,
      default: null
    },

    referenceId: {
      type: String,
      required: true,
      unique: true,
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

    description: {
      type: String,
      default: null
    },

    status: {
      type: String,
      enum: [
        'CREATED',
        'PAID',
        'PARTIALLY_PAID',
        'EXPIRED',
        'CANCELLED',
        'FAILED'
      ],
      default: 'CREATED',
      index: true
    },

    razorpayPaymentId: {
      type: String,
      default: null,
      index: true
    },

    razorpayOrderId: {
      type: String,
      default: null,
      index: true
    },

    transferredAmount: {
      type: Number,
      default: 0
    },

    transferStatus: {
      type: String,
      enum: [
        'NOT_STARTED',
        'PENDING',
        'PROCESSED',
        'FAILED',
        'REVERSED'
      ],
      default: 'NOT_STARTED',
      index: true
    },

    razorpayTransferId: {
      type: String,
      default: null,
      index: true
    },

    paymentResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    webhookPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    paidAt: {
      type: Date,
      default: null
    },

    transferredAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
)

razorpayPaymentLinkSchema.index({
  payerTransporterId: 1,
  status: 1
})

razorpayPaymentLinkSchema.index({
  beneficiaryTransporterId: 1,
  status: 1
})

razorpayPaymentLinkSchema.index({
  payerTransporterId: 1,
  createdAt: -1
})

module.exports = mongoose.model(
  'RazorpayPaymentLink',
  razorpayPaymentLinkSchema
)
