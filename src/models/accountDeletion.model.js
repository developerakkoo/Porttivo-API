const mongoose = require("mongoose");

const accountDeletionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    userType: {
      type: String,
      enum: ["customer", "driver", "transporter"],
      required: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
    },

    email: {
      type: String,
      default: null,
    },

    mobile: {
      type: String,
      default: null,
    },

    reason: {
      type: String,
      default: "",
    },

    deletedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model(
  "AccountDeletion",
  accountDeletionSchema
);