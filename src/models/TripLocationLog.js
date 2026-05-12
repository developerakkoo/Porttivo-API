const mongoose = require('mongoose');

const tripLocationLogSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
      index: true,
    },
    tripReference: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      required: true,
      index: true,
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      default: null,
      index: true,
    },
    vehicleNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
      index: true,
    },
    eventType: {
      type: String,
      enum: ['LOCATION_UPDATE'],
      required: true,
      index: true,
    },
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    accuracy: {
      type: Number,
      default: null,
    },
    speed: {
      type: Number,
      default: null,
    },
    heading: {
      type: Number,
      default: null,
    },
    socketId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    clientIp: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    userAgent: {
      type: String,
      trim: true,
      default: null,
    },
    source: {
      type: String,
      trim: true,
      default: 'socket',
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

tripLocationLogSchema.index({ tripId: 1, createdAt: -1 });
tripLocationLogSchema.index({ driverId: 1, createdAt: -1 });
tripLocationLogSchema.index({ eventType: 1, createdAt: -1 });

module.exports = mongoose.model('TripLocationLog', tripLocationLogSchema);
