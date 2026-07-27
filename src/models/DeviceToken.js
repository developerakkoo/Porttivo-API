const mongoose = require('mongoose')

/**
 * A registered FCM device token for a user. One row per token (unique); a user
 * may have multiple devices. Invalid tokens are pruned by the push service.
 */
const deviceTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    userType: {
      type: String,
      enum: ['TRANSPORTER', 'DRIVER', 'PUMP_OWNER', 'PUMP_STAFF', 'ADMIN', 'CUSTOMER'],
      required: true,
      index: true
    },
    token: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web', 'unknown'],
      default: 'unknown'
    },
    lastSeenAt: {
      type: Date,
      default: Date.now
    }
  },
  { timestamps: true }
)

deviceTokenSchema.index({ userId: 1, userType: 1 })

module.exports = mongoose.model('DeviceToken', deviceTokenSchema)
