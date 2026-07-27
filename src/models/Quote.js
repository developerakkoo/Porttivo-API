const mongoose = require('mongoose')

/**
 * A transporter's bid on a Requirement. One quote per transporter per
 * requirement; the requester selects (awards) exactly one.
 */
const quoteSchema = new mongoose.Schema(
  {
    requirementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Requirement',
      required: true,
      index: true
    },

    // Quoting transporter (seller / executor once awarded).
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true
    },

    price: {
      type: Number,
      required: true,
      min: 0
    },

    availability: {
      type: String,
      enum: ['TODAY', 'TOMORROW', 'CUSTOM'],
      default: 'TODAY'
    },

    // Set when availability === 'CUSTOM'.
    availabilityDate: {
      type: Date,
      default: null
    },

    message: {
      type: String,
      trim: true,
      default: null
    },

    status: {
      type: String,
      enum: ['SUBMITTED', 'SELECTED', 'NOT_SELECTED', 'WITHDRAWN'],
      default: 'SUBMITTED',
      index: true
    },

    // Requester's counter-offer (latest), if any.
    counterPrice: {
      type: Number,
      default: null,
      min: 0
    },

    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      default: null
    }
  },
  { timestamps: true }
)

// One quote per transporter per requirement.
quoteSchema.index({ requirementId: 1, transporterId: 1 }, { unique: true })
quoteSchema.index({ requirementId: 1, status: 1, createdAt: -1 })
quoteSchema.index({ transporterId: 1, status: 1, createdAt: -1 })

module.exports = mongoose.model('Quote', quoteSchema)
