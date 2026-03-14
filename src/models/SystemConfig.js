const mongoose = require('mongoose');

const systemConfigSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    milestoneRules: {
      containerPickedRequired: {
        type: Boolean,
        default: false,
      },
      reachedLocationRequired: {
        type: Boolean,
        default: false,
      },
      loadingUnloadingRequired: {
        type: Boolean,
        default: false,
      },
      reachedDestinationRequired: {
        type: Boolean,
        default: false,
      },
      tripCompletedRequired: {
        type: Boolean,
        default: false,
      },
      podRequiredForBillable: {
        type: Boolean,
        default: true,
      },
    },
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('SystemConfig', systemConfigSchema);
