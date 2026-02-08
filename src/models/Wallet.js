const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: [true, 'User ID is required'],
      index: true,
    },
    userType: {
      type: String,
      enum: ['TRANSPORTER', 'DRIVER', 'PUMP_OWNER'],
      required: [true, 'User type is required'],
      index: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR', 'USD'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to ensure one wallet per user
walletSchema.index({ userId: 1, userType: 1 }, { unique: true });

// Index for balance queries
walletSchema.index({ balance: 1 });

// Method to check if sufficient balance
walletSchema.methods.hasSufficientBalance = function (amount) {
  return this.balance >= amount;
};

// Method to add balance
walletSchema.methods.addBalance = function (amount) {
  this.balance += amount;
  return this.save();
};

// Method to deduct balance
walletSchema.methods.deductBalance = function (amount) {
  if (!this.hasSufficientBalance(amount)) {
    throw new Error('Insufficient balance');
  }
  this.balance -= amount;
  return this.save();
};

module.exports = mongoose.model('Wallet', walletSchema);
