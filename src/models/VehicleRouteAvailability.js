const mongoose = require('mongoose')

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
      required: true,
      validate: {
        validator: function (val) {
          return Array.isArray(val) && val.length === 2
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
      index: '2dsphere' // for geo queries
    },

    destination: {
      type: locationSchema,
      default: null,
      index: '2dsphere'
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
      enum: ['active', 'cancelled', 'expired'],
      default: 'active',
      index: true,
    },
  },
  { timestamps: true }
)

// 🔥 Compound index (geo + date)
vehicleRouteAvailabilitySchema.index({
  'origin.coordinates': '2dsphere',
  availableFrom: 1,
})

module.exports = mongoose.model(
  'VehicleRouteAvailability',
  vehicleRouteAvailabilitySchema
)