const mongoose = require('mongoose')
const { normalizeLocationInput } = require('../utils/location')

// Reusable GeoJSON location (same shape as VehicleRouteAvailability).
const locationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [],
      validate: {
        validator: function (val) {
          if (!Array.isArray(val)) return false
          if (val.length === 0) return true
          if (val.length !== 2) return false
          return val.every(Number.isFinite)
        },
        message: 'coordinates must be [longitude, latitude]'
      }
    },
    formattedAddress: {
      type: String,
      required: true,
      trim: true
    }
  },
  { _id: false }
)

/**
 * A requester-posted transport inquiry ("Post Inquiry" flow). Matching
 * transporters are notified and can submit a Quote; the requester awards one,
 * which becomes a marketplace Trip.
 */
const requirementSchema = new mongoose.Schema(
  {
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true
    },

    // Human-readable reference shown in the UI, e.g. "REQ-7821".
    ref: {
      type: String,
      trim: true,
      unique: true,
      index: true
    },

    origin: {
      type: locationSchema,
      required: true,
      set: normalizeLocationInput
    },

    destination: {
      type: locationSchema,
      required: true,
      set: normalizeLocationInput
    },

    vehicleType: {
      type: String,
      trim: true,
      required: true,
      index: true
    },

    direction: {
      type: String,
      enum: ['EXPORT', 'IMPORT', 'LOCAL'],
      default: 'EXPORT'
    },

    noOfVehicles: {
      type: Number,
      default: 1,
      min: 1
    },

    requiredBy: {
      type: Date,
      default: null
    },

    remarks: {
      type: String,
      trim: true,
      default: null
    },

    status: {
      type: String,
      enum: ['OPEN', 'AWARDED', 'CANCELLED', 'EXPIRED', 'CLOSED'],
      default: 'OPEN',
      index: true
    },

    awardedQuoteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Quote',
      default: null
    },

    // Snapshot of transporter ids the inquiry was broadcast to (for auditing).
    broadcastTo: {
      type: [mongoose.Schema.Types.ObjectId],
      default: []
    }
  },
  { timestamps: true }
)

requirementSchema.index({ requesterId: 1, status: 1, createdAt: -1 })
requirementSchema.index({ status: 1, vehicleType: 1, createdAt: -1 })

/** Build a short, human-readable reference from a document id. */
requirementSchema.statics.buildRef = function (id) {
  return `REQ-${String(id).slice(-6).toUpperCase()}`
}

module.exports = mongoose.model('Requirement', requirementSchema)
