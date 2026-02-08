const mongoose = require('mongoose');

const fuelCardSchema = new mongoose.Schema(
  {
    cardNumber: {
      type: String,
      required: [true, 'Card number is required'],
      unique: true,
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
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
      index: true,
    },
    balance: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked', 'expired'],
      default: 'active',
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
fuelCardSchema.index({ transporterId: 1, status: 1 });
fuelCardSchema.index({ driverId: 1, status: 1 });
fuelCardSchema.index({ cardNumber: 1 });

// Virtual for checking if card is assigned
fuelCardSchema.virtual('isAssigned').get(function () {
  return !!this.driverId;
});

module.exports = mongoose.model('FuelCard', fuelCardSchema);
