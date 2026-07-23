const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { validateMobile, validateEmail } = require('../utils/validation');

const companyUserSchema = new mongoose.Schema(
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
      required: [true, 'Name is required'],
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
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: [true, 'Transporter ID is required'],
      index: true,
    },
    pin: {
      type: String,
      select: false, // Don't return PIN by default
    },
    hasAccess: {
      type: Boolean,
      default: false,
    },
    permissions: {
      type: [String],
      enum: [
        'viewTrips',
        'createTrips',
        'manageDrivers',
        'manageVehicles',
        'manageWallet',
        'manageFuelCards',
        'manageUsers',
        'viewReports',
      ],
      default: [],
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked'],
      default: 'active',
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
      // Full bank account and IFSC are stored at Cashfree only, never here.
      bankAccountLast4: {
        type: String,
        trim: true,
        default: null,
      },
      address: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      verification: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      providerResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      removalResponse: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },
      verifiedAt: {
        type: Date,
        default: null,
      },
      deletedAt: {
        type: Date,
        default: null,
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
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Hash PIN before saving
companyUserSchema.pre('save', async function () {
  if (!this.isModified('pin') || !this.pin) {
    return;
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.pin = await bcrypt.hash(this.pin, salt);
  } catch (error) {
    throw error;
  }
});

// Method to compare PIN
companyUserSchema.methods.comparePin = async function (candidatePin) {
  if (!this.pin) {
    return false;
  }
  return await bcrypt.compare(candidatePin, this.pin);
};

// Method to check if PIN is set
companyUserSchema.methods.hasPinSet = function () {
  return !!this.pin;
};

module.exports = mongoose.model('CompanyUser', companyUserSchema);
