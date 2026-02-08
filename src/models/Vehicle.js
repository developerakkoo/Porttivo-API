const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema(
  {
    vehicleNumber: {
      type: String,
      required: [true, 'Vehicle number is required'],
      index: true,
      trim: true,
      uppercase: true,
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: [true, 'Transporter ID is required'],
      index: true,
    },
    ownerType: {
      type: String,
      enum: ['OWN', 'HIRED'],
      required: [true, 'Owner type is required'],
      default: 'OWN',
      index: true,
    },
    originalOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
      index: true,
    },
    hiredBy: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Transporter',
      default: [],
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    trailerType: {
      type: String,
      trim: true,
    },
    documents: {
      rc: {
        url: String,
        expiryDate: Date,
        uploadedAt: Date,
      },
      insurance: {
        url: String,
        expiryDate: Date,
        uploadedAt: Date,
      },
      fitness: {
        url: String,
        expiryDate: Date,
        uploadedAt: Date,
      },
      permit: {
        url: String,
        expiryDate: Date,
        uploadedAt: Date,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
vehicleSchema.index({ transporterId: 1, status: 1 });
vehicleSchema.index({ driverId: 1 });
vehicleSchema.index({ vehicleNumber: 1, ownerType: 1 });
vehicleSchema.index({ vehicleNumber: 1, transporterId: 1, ownerType: 1 });

// Compound unique index: For OWN vehicles, vehicleNumber must be unique globally
// For HIRED vehicles, same vehicleNumber can exist for multiple transporters
vehicleSchema.index(
  { vehicleNumber: 1, ownerType: 1 },
  {
    unique: true,
    partialFilterExpression: { ownerType: 'OWN' },
  }
);

// Virtual to check if vehicle has any trip history
vehicleSchema.virtual('hasTripHistory').get(function () {
  // This will be checked in the controller using Trip model
  return false;
});

// Pre-save hook to set originalOwnerId for OWN vehicles
vehicleSchema.pre('save', function () {
  if (this.isNew && this.ownerType === 'OWN' && !this.originalOwnerId) {
    this.originalOwnerId = this.transporterId;
  }
});

module.exports = mongoose.model('Vehicle', vehicleSchema);
