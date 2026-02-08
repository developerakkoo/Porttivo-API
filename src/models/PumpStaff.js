const mongoose = require('mongoose');

const pumpStaffSchema = new mongoose.Schema(
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
    pumpOwnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PumpOwner',
      required: [true, 'Pump Owner ID is required'],
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'blocked', 'disabled'],
      default: 'active',
      index: true,
    },
    permissions: {
      canProcessFuel: {
        type: Boolean,
        default: true,
      },
      canViewTransactions: {
        type: Boolean,
        default: false, // Attendants cannot view transactions/reports
      },
      canViewSettlements: {
        type: Boolean,
        default: false, // Attendants cannot view settlements
      },
      canManageStaff: {
        type: Boolean,
        default: false,
      },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
pumpStaffSchema.index({ pumpOwnerId: 1, status: 1 });
pumpStaffSchema.index({ mobile: 1 });

module.exports = mongoose.model('PumpStaff', pumpStaffSchema);
