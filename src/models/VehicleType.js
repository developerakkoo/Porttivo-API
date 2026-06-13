const mongoose = require('mongoose');

const vehicleTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true, maxlength: 100 },
    code: { type: String, trim: true, default: null },
    description: { type: String, default: null },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

vehicleTypeSchema.index({ name: 1 });
vehicleTypeSchema.index({ isActive: 1, sortOrder: 1 });

module.exports = mongoose.model('VehicleType', vehicleTypeSchema);
