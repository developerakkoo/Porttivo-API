const mongoose = require('mongoose')

const payoutSchema = new mongoose.Schema(
  {
    payerId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    payeeId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    payeeType: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    paymentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PaymentSession',
      default: null
    },
    referenceType: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    referenceId: {
      type: String,
      trim: true,
      default: null,
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
    provider: {
      type: String,
      enum: ['CASHFREE'],
      default: 'CASHFREE',
      index: true
    },
    cashfree: {
      beneId: {
        type: String,
        trim: true,
        default: null
      },
      transferId: {
        type: String,
        trim: true,
        default: null
      },
      referenceId: {
        type: String,
        trim: true,
        default: null,
        index: true
      },
      transferMode: {
        type: String,
        trim: true,
        default: 'IMPS'
      },
      utr: {
        type: String,
        trim: true,
        default: null,
        index: true
      },
      beneficiary: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      request: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      },
      response: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
      }
    },
    status: {
      type: String,
      enum: ['CREATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'RETRY_PENDING', 'CANCELLED'],
      default: 'CREATED'
    },
    failure: {
      code: {
        type: String,
        trim: true,
        default: null,
        index: true
      },
      message: {
        type: String,
        trim: true,
        default: null
      },
      reason: {
        type: String,
        trim: true,
        default: null
      },
      isRetryable: {
        type: Boolean,
        default: false
      }
    },
    retry: {
      count: {
        type: Number,
        default: 0,
        min: 0
      },
      maxRetry: {
        type: Number,
        default: 3,
        min: 0
      },
      nextRetryAt: {
        type: Date,
        default: null,
        index: true
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
    startedAt: {
      type: Date,
      default: null
    },
    lastAttemptAt: {
      type: Date,
      default: null
    },
    lastWebhookAt: {
      type: Date,
      default: null
    },
    logs: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    }
  },
  {
    timestamps: true
  }
)

payoutSchema.index({ paymentId: 1 }, { unique: true, sparse: true })
payoutSchema.index({ referenceType: 1, referenceId: 1, provider: 1 })
payoutSchema.index({ 'cashfree.transferId': 1 }, { unique: true, sparse: true })
payoutSchema.index({ 'cashfree.beneId': 1 })
payoutSchema.index({ status: 1, 'retry.nextRetryAt': 1, updatedAt: -1 })

module.exports = mongoose.model('Payout', payoutSchema)
