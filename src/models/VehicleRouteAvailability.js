const mongoose = require('mongoose');

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
    origin: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    destination: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    quantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    // remaining slots available for vehicles to be attached to this post
    slotsLeft: {
      type: Number,
      default: 1,
      min: 0,
    },
    // optional suggested price per vehicle for this route (in smallest currency unit)
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
);

vehicleRouteAvailabilitySchema.index({ origin: 1, destination: 1, availableFrom: 1 });

module.exports = mongoose.model('VehicleRouteAvailability', vehicleRouteAvailabilitySchema);
