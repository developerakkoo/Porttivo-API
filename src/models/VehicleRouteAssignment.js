const mongoose = require('mongoose');

const vehicleRouteAssignmentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleRouteAvailability',
      required: true,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      required: true,
      index: true,
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },
    // price agreed/posted for this vehicle on the route
    price: {
      type: Number,
      required: false,
      min: 0,
    },
    note: { type: String, default: null },

    /**
     * Which destination stop indices (0 = primary) this vehicle serves on the listing.
     * Omitted on legacy rows => treated as all stops when reading.
     */
    servedStopIndexes: {
      type: [Number],
      default: undefined,
    },
  },
  { timestamps: true }
);

vehicleRouteAssignmentSchema.index({ postId: 1, vehicleId: 1 }, { unique: true });

module.exports = mongoose.model('VehicleRouteAssignment', vehicleRouteAssignmentSchema);
