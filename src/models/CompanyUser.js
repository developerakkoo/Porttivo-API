const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
          return /^[0-9]{10}$/.test(v);
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
