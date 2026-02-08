const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema(
  {
    pumpOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PumpOwner',
      required: [true, 'Pump Owner ID is required'],
      index: true,
    },
    period: {
      type: String,
      required: [true, 'Settlement period is required'],
      trim: true,
    },
    startDate: {
      type: Date,
      required: [true, 'Start date is required'],
      index: true,
    },
    endDate: {
      type: Date,
      required: [true, 'End date is required'],
      index: true,
    },
    fuelValue: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    commission: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    commissionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    netPayable: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    status: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    utr: {
      type: String,
      trim: true,
      uppercase: true,
      default: null,
    },
    transactions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FuelTransaction',
      },
    ],
    processedAt: {
      type: Date,
      default: null,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
settlementSchema.index({ pumpOwnerId: 1, status: 1 });
settlementSchema.index({ startDate: 1, endDate: 1 });
settlementSchema.index({ status: 1, createdAt: -1 });
settlementSchema.index({ utr: 1 });

// Virtual for transaction count
settlementSchema.virtual('transactionCount').get(function () {
  return this.transactions ? this.transactions.length : 0;
});

module.exports = mongoose.model('Settlement', settlementSchema);
