const mongoose = require('mongoose');

const vehicleTypeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    code: { type: String, trim: true, default: null },
    description: { type: String, default: null },
  },
  { timestamps: true }
);

vehicleTypeSchema.index({ name: 1 });

module.exports = mongoose.model('VehicleType', vehicleTypeSchema);
