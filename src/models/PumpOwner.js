const mongoose = require('mongoose');
const { validateMobile, validateEmail } = require('../utils/validation');
const bcrypt = require('bcryptjs');

const pumpOwnerSchema = new mongoose.Schema(
  {
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
      index: true,
      trim: true,
      validate: {
        validator: function (v) {
          return validateMobile(v);
        },
        message: 'Mobile number must be 10 digits',
      },
    },
    name: {
      type: String,
      trim: true,
    },
    pumpName: {
      type: String,
      required: [true, 'Pump name is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: function (v) {
          if (v == null || v === '') return true;
          return validateEmail(v);
        },
        message: 'Please provide a valid email',
      },
    },
    location: {
      address: {
        type: String,
        trim: true,
      },
      coordinates: {
        latitude: {
          type: Number,
        },
        longitude: {
          type: Number,
        },
      },
      city: {
        type: String,
        trim: true,
      },
      state: {
        type: String,
        trim: true,
      },
      pincode: {
        type: String,
        trim: true,
      },
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked', 'pending'],
      default: 'pending',
      index: true,
    },
    walletBalance: {
      type: Number,
      default: 0,
    },
    cashfreeBeneId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    cashfreeBeneficiary: {
      beneId: {
        type: String,
        trim: true,
        default: null,
      },
      name: {
        type: String,
        trim: true,
        default: null,
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
        default: null,
      },
      phone: {
        type: String,
        trim: true,
        default: null,
      },
      status: {
        type: String,
        trim: true,
        default: null,
      },
      bankAccountEncrypted: {
        type: String,
        default: null,
      },
      ifscEncrypted: {
        type: String,
        default: null,
      },
      bankAccountLast4: {
        type: String,
        trim: true,
        default: null,
      },
      verification: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      createdAt: {
        type: Date,
        default: null,
      },
      updatedAt: {
        type: Date,
        default: null,
      },
    },
    commissionRate: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    // Statistics for ranking
    totalDriversVisited: {
      type: Number,
      default: 0,
    },
    totalTransporters: {
      type: Number,
      default: 0,
    },
    totalFuelValue: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
pumpOwnerSchema.index({ status: 1 });
pumpOwnerSchema.index({ 'location.coordinates.latitude': 1, 'location.coordinates.longitude': 1 });

module.exports = mongoose.model('PumpOwner', pumpOwnerSchema);
