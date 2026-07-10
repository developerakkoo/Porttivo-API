const mongoose = require('mongoose');
const { validateMobile, validateEmail } = require('../utils/validation');

const customerSchema = new mongoose.Schema(
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
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      validate: {
        validator: function (v) {
          if (v == null || v === '') return true;
          return validateEmail(v);
        },
        message: 'Please provide a valid email',
      },
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked'],
      default: 'active',
    },
    isRegistered: {
      type: Boolean,
      default: false,
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Customer', customerSchema);
