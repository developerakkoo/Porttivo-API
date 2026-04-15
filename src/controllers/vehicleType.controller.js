const VehicleType = require('../models/VehicleType');

const listVehicleTypes = async (req, res, next) => {
  try {
    const types = await VehicleType.find().sort({ name: 1 }).lean();
    return res.status(200).json({ success: true, data: { results: types } });
  } catch (err) {
    next(err);
  }
};

const createVehicleType = async (req, res, next) => {
  try {
    const { name, code, description } = req.body;
    if (!name || !name.toString().trim()) return res.status(400).json({ success: false, message: 'name is required' });

    const existing = await VehicleType.findOne({ name: name.trim() });
    if (existing) return res.status(400).json({ success: false, message: 'Vehicle type already exists' });

    const vt = await VehicleType.create({ name: name.trim(), code: code || null, description: description || null });
    return res.status(201).json({ success: true, message: 'Vehicle type created', data: { vehicleType: vt } });
  } catch (err) {
    next(err);
  }
};

const updateVehicleType = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, code, description } = req.body;
    const vt = await VehicleType.findById(id);
    if (!vt) return res.status(404).json({ success: false, message: 'Vehicle type not found' });
    if (name !== undefined) vt.name = name?.trim() || vt.name;
    if (code !== undefined) vt.code = code || null;
    if (description !== undefined) vt.description = description || null;
    await vt.save();
    return res.status(200).json({ success: true, message: 'Vehicle type updated', data: { vehicleType: vt } });
  } catch (err) {
    next(err);
  }
};

const deleteVehicleType = async (req, res, next) => {
  try {
    const { id } = req.params;
    const vt = await VehicleType.findById(id);
    if (!vt) return res.status(404).json({ success: false, message: 'Vehicle type not found' });
    await vt.remove();
    return res.status(200).json({ success: true, message: 'Vehicle type deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = { listVehicleTypes, createVehicleType, updateVehicleType, deleteVehicleType };
