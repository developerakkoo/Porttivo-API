const mongoose = require('mongoose');
const locationSchema = require('./schemas/location.schema');

const savedLocationActorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    userType: {
      type: String,
      enum: ['ADMIN', 'SYSTEM'],
      default: 'ADMIN',
    },
  },
  { _id: false }
);

const savedLocationSchema = new mongoose.Schema(
  {
    locationId: {
      type: String,
      unique: true,
      required: true,
      default: () => `LOC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    location: {
      type: locationSchema,
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: savedLocationActorSchema,
      default: () => ({}),
    },
    updatedBy: {
      type: savedLocationActorSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

savedLocationSchema.index({ label: 1 });
savedLocationSchema.index({ 'location.formattedAddress': 1 });
savedLocationSchema.index({ 'location.placeId': 1 });
savedLocationSchema.index({ createdAt: -1 });

module.exports = mongoose.model('SavedLocation', savedLocationSchema);
