const mongoose = require('mongoose');

const locationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
      required: true,
    },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length === 2 &&
            value.every((coordinate) => Number.isFinite(coordinate))
          );
        },
        message: 'coordinates must be [longitude, latitude]',
      },
    },
    formattedAddress: {
      type: String,
      required: true,
      trim: true,
    },
    placeId: {
      type: String,
      trim: true,
      default: null,
    },
    addressLine1: {
      type: String,
      trim: true,
      default: null,
    },
    locality: {
      type: String,
      trim: true,
      default: null,
    },
    administrativeArea: {
      type: String,
      trim: true,
      default: null,
    },
    postalCode: {
      type: String,
      trim: true,
      default: null,
    },
    countryCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    name: {
      type: String,
      trim: true,
      default: null,
    },
    provider: {
      type: String,
      enum: ['google_places', 'google_geocoding', 'manual'],
      default: null,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

module.exports = locationSchema;
