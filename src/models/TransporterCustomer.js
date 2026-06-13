const mongoose = require('mongoose');

const transporterCustomerSchema = new mongoose.Schema(
  {
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

transporterCustomerSchema.index({ transporterId: 1, normalizedName: 1 }, { unique: true });
transporterCustomerSchema.index({ transporterId: 1, lastUsedAt: -1 });

module.exports = mongoose.model('TransporterCustomer', transporterCustomerSchema);
