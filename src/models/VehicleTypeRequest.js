const mongoose = require('mongoose');

const vehicleTypeRequestSchema = new mongoose.Schema(
  {
    requestedName: {
      type: String,
      required: [true, 'Requested name is required'],
      trim: true,
      maxlength: 100,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    submittedByTransporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: true,
      index: true,
    },
    submittedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    submittedByUserType: {
      type: String,
      enum: ['transporter', 'company-user'],
      required: true,
    },
    reviewedByAdminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500,
    },
    approvedVehicleTypeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleType',
      default: null,
    },
  },
  { timestamps: true }
);

vehicleTypeRequestSchema.index({ status: 1, createdAt: -1 });
vehicleTypeRequestSchema.index({ submittedByTransporterId: 1, status: 1 });
vehicleTypeRequestSchema.index(
  { normalizedName: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
  }
);

module.exports = mongoose.model('VehicleTypeRequest', vehicleTypeRequestSchema);
