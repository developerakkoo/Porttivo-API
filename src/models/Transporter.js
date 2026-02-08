const mongoose = require('mongoose');
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
          return /^[0-9]{10}$/.test(v);
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
    },
    company: {
      type: String,
      trim: true,
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
