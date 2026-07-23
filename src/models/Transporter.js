const mongoose = require('mongoose');
const { validateMobile, validateEmail } = require('../utils/validation');
const {
  OPERATING_COUNTRIES,
  DEFAULT_OPERATING_COUNTRY,
} = require('../constants/operatingCountries');
const bcrypt = require('bcryptjs');

const transporterSchema = new mongoose.Schema(
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
    company: {
      type: String,
      trim: true,
    },
    operatingCountry: {
      type: String,
      trim: true,
      uppercase: true,
      default: DEFAULT_OPERATING_COUNTRY,
      enum: {
        values: OPERATING_COUNTRIES,
        message: 'Operating country must be a supported ISO country code',
      },
    },
    pin: {
      type: String,
      select: false, // Don't return PIN by default
    },
    hasAccess: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked', 'pending'],
      default: 'active',
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
  },
  {
    timestamps: true,
  }
);

// Hash PIN before saving
transporterSchema.pre('save', async function () {
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
transporterSchema.methods.comparePin = async function (candidatePin) {
  if (!this.pin) {
    return false;
  }
  return await bcrypt.compare(candidatePin, this.pin);
};

// Method to check if PIN is set
transporterSchema.methods.hasPinSet = function () {
  return !!this.pin;
};

module.exports = mongoose.model('Transporter', transporterSchema);
