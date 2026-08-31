const mongoose = require('mongoose')

const razorpayRouteAccountSchema = new mongoose.Schema(
  {
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      unique: true,
      index: true
    },

    accountId: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true
    },

    status: {
      type: String,
      enum: [
        'CREATED',
        'ACTIVE',
        'PENDING',
        'SUSPENDED',
        'REJECTED',
        'INACTIVE'
      ],
      default: 'CREATED',
      index: true
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
    },

    businessName: {
      type: String,
      trim: true,
      default: null
    },

    bankAccountLast4: {
      type: String,
      trim: true,
      default: null
    },

    ifsc: {
      type: String,
      trim: true,
      uppercase: true,
      default: null
    },

    providerResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },

    activatedAt: {
      type: Date,
      default: null
    },

    lastSyncedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
)

razorpayRouteAccountSchema.index({
  transporterId: 1,
  status: 1
})

module.exports = mongoose.model(
  'RazorpayRouteAccount',
  razorpayRouteAccountSchema
)