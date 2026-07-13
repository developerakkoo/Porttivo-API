const mongoose = require('mongoose');

const driverSchema = new mongoose.Schema(
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
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
    },
    status: {
      type: String,
      enum: ['pending', 'active', 'inactive', 'blocked'],
      default: 'active',
    },
    isBusy: {
      type: Boolean,
      default: false,
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'low',
    },
    language: {
      type: String,
      enum: ['en', 'hi', 'mr'],
      default: 'en',
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
      address: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
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
    appInstalled: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

driverSchema.virtual('assignedVehicle', {
  ref: 'Vehicle',
  localField: '_id',
  foreignField: 'driverId',
  justOne: true,
});

driverSchema.set('toJSON', { virtuals: true });
driverSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Driver', driverSchema);
