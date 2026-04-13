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
      enum: ['20FT', '40FT', '40FT Open', 'Trailer', 'Closed Body', '22FT'],
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
