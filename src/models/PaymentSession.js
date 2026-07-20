const mongoose = require('mongoose')
const { nanoid } = require('nanoid')

const paymentSessionSchema = new mongoose.Schema(
  {
    referenceType: {
      type: String,
      trim: true,
      required: true,
      index: true
    },
    publicId: {
      type: String,
      trim: true,
      unique: true,
      index: true,
      default: () => `pay_${nanoid(12)}`
    },
    referenceId: {
      type: String,
      trim: true,
      required: true,
      index: true
    },
    purpose: {
      type: String,
      trim: true,
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['PAYU', 'CASHFREE'],
      required: true,
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
      sparse: true
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
    payer: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
        index: true
      },
      userType: {
        type: String,
        trim: true,
        default: null,
        index: true
      },
      name: {
        type: String,
        trim: true,
        default: null
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
        default: null
      },
      mobile: {
        type: String,
        trim: true,
        default: null
      }
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
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

paymentSessionSchema.index({ referenceType: 1, referenceId: 1, provider: 1, createdAt: -1 })
paymentSessionSchema.index({ provider: 1, merchantTransactionId: 1 })
paymentSessionSchema.index({ providerTransactionId: 1 })
paymentSessionSchema.index({ createdAt: -1 })
paymentSessionSchema.index({ publicId: 1 }, { unique: true, sparse: true })

module.exports = mongoose.model('PaymentSession', paymentSessionSchema)
