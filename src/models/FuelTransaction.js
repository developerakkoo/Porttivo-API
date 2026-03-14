const mongoose = require('mongoose');

// Location schema
const locationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      required: true,
    },
    longitude: {
      type: Number,
      required: true,
    },
    address: {
      type: String,
      trim: true,
    },
    accuracy: {
      type: Number,
      default: null,
    },
  },
  { _id: false }
);

// Receipt schema
const receiptSchema = new mongoose.Schema(
  {
    photo: {
      type: String,
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },
  },
  { _id: false }
);

// Fraud flags schema
const fraudFlagsSchema = new mongoose.Schema(
  {
    duplicateReceipt: {
      type: Boolean,
      default: false,
    },
    gpsMismatch: {
      type: Boolean,
      default: false,
    },
    gpsMismatchDistance: {
      type: Number,
      default: null, // Distance in km
    },
    expressUploads: {
      type: Boolean,
      default: false,
    },
    unusualPattern: {
      type: Boolean,
      default: false,
    },
    flaggedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    flaggedAt: {
      type: Date,
      default: null,
    },
    resolved: {
      type: Boolean,
      default: false,
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  { _id: false }
);

const fuelTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      unique: true,
      required: true,
      default: () => `FTX-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      index: true,
    },
    pumpOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PumpOwner',
      default: null,
      index: true,
    },
    pumpStaffId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PumpStaff',
      default: null,
      index: true,
    },
    vehicleNumber: {
      type: String,
      required: [true, 'Vehicle number is required'],
      trim: true,
      uppercase: true,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      required: [true, 'Driver ID is required'],
      index: true,
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
      index: true,
    },
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      default: null,
      index: true,
    },
    transactionType: {
      type: String,
      enum: ['PORTTIVO_CARD', 'CASH_RECEIPT'],
      default: 'PORTTIVO_CARD',
      index: true,
    },
    fuelCardId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FuelCard',
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
    },
    qrCode: {
      type: String,
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    qrCodeExpiry: {
      type: Date,
      default: null,
      index: true,
    },
    location: {
      type: locationSchema,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'completed', 'cancelled', 'flagged'],
      default: 'pending',
      index: true,
    },
    settlementStatus: {
      type: String,
      enum: ['NOT_APPLICABLE', 'UNSETTLED', 'INCLUDED', 'SETTLED'],
      default: 'UNSETTLED',
      index: true,
    },
    settlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Settlement',
      default: null,
      index: true,
    },
    walletTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WalletTransaction',
      default: null,
    },
    receipt: {
      type: receiptSchema,
      default: {},
    },
    review: {
      status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
        default: 'PENDING',
      },
      reviewedAt: {
        type: Date,
        default: null,
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      notes: {
        type: String,
        trim: true,
        default: null,
      },
    },
    cashback: {
      eligible: {
        type: Boolean,
        default: false,
      },
      rate: {
        type: Number,
        default: 0,
      },
      amount: {
        type: Number,
        default: 0,
      },
      status: {
        type: String,
        enum: ['NOT_APPLICABLE', 'PENDING', 'APPROVED', 'REJECTED', 'CREDITED'],
        default: 'NOT_APPLICABLE',
      },
      reviewedAt: {
        type: Date,
        default: null,
      },
      reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },
      creditedAt: {
        type: Date,
        default: null,
      },
      walletTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'WalletTransaction',
        default: null,
      },
      notes: {
        type: String,
        trim: true,
        default: null,
      },
    },
    fraudFlags: {
      type: fraudFlagsSchema,
      default: {},
    },
    confirmedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
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
fuelTransactionSchema.index({ driverId: 1, status: 1 });
fuelTransactionSchema.index({ transporterId: 1, transactionType: 1, createdAt: -1 });
fuelTransactionSchema.index({ pumpOwnerId: 1, status: 1 });
fuelTransactionSchema.index({ fuelCardId: 1 });
fuelTransactionSchema.index({ vehicleNumber: 1 });
fuelTransactionSchema.index({ createdAt: -1 });
fuelTransactionSchema.index({ transactionType: 1, 'review.status': 1 });
fuelTransactionSchema.index({ settlementStatus: 1, settlementId: 1 });
fuelTransactionSchema.index({ 'fraudFlags.resolved': 1, 'fraudFlags.duplicateReceipt': 1 });
fuelTransactionSchema.index({ 'fraudFlags.resolved': 1, 'fraudFlags.gpsMismatch': 1 });

// Method to check if QR code is expired
fuelTransactionSchema.methods.isQRExpired = function () {
  if (!this.qrCodeExpiry) {
    return false;
  }

  return this.qrCodeExpiry < new Date();
};

// Method to check if transaction has fraud flags
fuelTransactionSchema.methods.hasFraudFlags = function () {
  return (
    this.fraudFlags.duplicateReceipt ||
    this.fraudFlags.gpsMismatch ||
    this.fraudFlags.expressUploads ||
    this.fraudFlags.unusualPattern
  );
};

module.exports = mongoose.model('FuelTransaction', fuelTransactionSchema);
