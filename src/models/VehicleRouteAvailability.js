const mongoose = require('mongoose')
const { normalizeLocationInput } = require('../utils/location')

// 🔥 Reusable location schema (GeoJSON)
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

const vehicleRouteAvailabilitySchema = new mongoose.Schema(
  {
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },

    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      default: null,
      index: true,
    },

    vehicleType: {
      type: String,
      trim: true,
      required: true,
      index: true,
    },

    // 🔥 UPDATED (GeoJSON)
    origin: {
      type: locationSchema,
      required: true,
      set: normalizeLocationInput
    },

    destination: {
      type: locationSchema,
      default: null,
      set: normalizeLocationInput
    },

    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },

    slotsLeft: {
      type: Number,
      default: 1,
      min: 0,
    },

    pricePerVehicle: {
      type: Number,
      default: null,
      min: 0,
    },

    availableFrom: {
      type: Date,
      required: true,
      index: true,
    },

    availableTo: {
      type: Date,
      required: true,
      index: true,
    },

    note: { type: String },

    status: {
      type: String,
      enum: ['active', 'cancelled', 'expired', 'fulfilled'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model(
  'VehicleRouteAvailability',
  vehicleRouteAvailabilitySchema
)
