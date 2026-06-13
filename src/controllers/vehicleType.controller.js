const VehicleType = require('../models/VehicleType');
const {
  serializeType,
  listActiveTypes,
  listAllTypes,
  getUsageCounts,
} = require('../services/vehicleTypeCatalog.service');

const canReadVehicleTypes = (req) => {
  if (req.user?.userType === 'admin') return true;
  if (req.user?.userType === 'transporter') return true;
  if (req.user?.userType === 'company-user') {
    const perms = req.user.permissions || [];
    return perms.includes('manageVehicles') || perms.includes('all');
  }
  return false;
};

const listPublicVehicleTypes = async (req, res, next) => {
  try {
    if (!canReadVehicleTypes(req)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied.',
      });
    }

    const q = req.query.q?.toString()?.trim() || '';
    const results = await listActiveTypes({ q: q || undefined });
    return res.status(200).json({ success: true, data: { results } });
  } catch (err) {
    next(err);
  }
};

const listVehicleTypes = async (req, res, next) => {
  try {
    const types = await listAllTypes();
    const withUsage = await Promise.all(
      types.map(async (t) => {
        const usage = await getUsageCounts(t.name);
        return { ...t, usage };
      })
    );
    return res.status(200).json({ success: true, data: { results: withUsage } });
  } catch (err) {
    next(err);
  }
};

const createVehicleType = async (req, res, next) => {
  try {
    const { name, code, description, isActive, sortOrder } = req.body;
    const trimmedName = name?.toString?.()?.trim?.();
    if (!trimmedName) {
      return res.status(400).json({ success: false, message: 'name is required' });
    }
    if (trimmedName.length > 100) {
      return res.status(400).json({ success: false, message: 'name must be 100 characters or less' });
    }

    const existing = await VehicleType.findOne({ name: trimmedName });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Vehicle type already exists' });
    }

    const vt = await VehicleType.create({
      name: trimmedName,
      code: code?.toString?.()?.trim?.() || null,
      description: description?.toString?.()?.trim?.() || null,
      isActive: isActive !== false,
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    });

    return res.status(201).json({
      success: true,
      message: 'Vehicle type created',
      data: { vehicleType: serializeType(vt) },
    });
  } catch (err) {
    next(err);
  }
};

const updateVehicleType = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, code, description, isActive, sortOrder } = req.body;
    const vt = await VehicleType.findById(id);
    if (!vt) return res.status(404).json({ success: false, message: 'Vehicle type not found' });

    if (name !== undefined) {
      const trimmedName = name?.toString?.()?.trim?.();
      if (!trimmedName) {
        return res.status(400).json({ success: false, message: 'name cannot be empty' });
      }
      if (trimmedName.length > 100) {
        return res.status(400).json({ success: false, message: 'name must be 100 characters or less' });
      }
      if (trimmedName !== vt.name) {
        const duplicate = await VehicleType.findOne({ name: trimmedName });
        if (duplicate) {
          return res.status(400).json({ success: false, message: 'Vehicle type name already exists' });
        }
        vt.name = trimmedName;
      }
    }

    if (code !== undefined) vt.code = code?.toString?.()?.trim?.() || null;
    if (description !== undefined) vt.description = description?.toString?.()?.trim?.() || null;
    if (isActive !== undefined) vt.isActive = Boolean(isActive);
    if (sortOrder !== undefined) {
      vt.sortOrder = Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : vt.sortOrder;
    }

    await vt.save();
    const usage = await getUsageCounts(vt.name);
    return res.status(200).json({
      success: true,
      message: 'Vehicle type updated',
      data: { vehicleType: { ...serializeType(vt), usage } },
    });
  } catch (err) {
    next(err);
  }
};

const deleteVehicleType = async (req, res, next) => {
  try {
    const { id } = req.params;
    const vt = await VehicleType.findById(id);
    if (!vt) return res.status(404).json({ success: false, message: 'Vehicle type not found' });

    const usage = await getUsageCounts(vt.name);
    if (usage.total > 0) {
      return res.status(409).json({
        success: false,
        message: 'Cannot delete vehicle type in use. Deactivate it instead.',
        data: { usage },
      });
    }

    await VehicleType.deleteOne({ _id: vt._id });
    return res.status(200).json({ success: true, message: 'Vehicle type deleted' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listPublicVehicleTypes,
  listVehicleTypes,
  createVehicleType,
  updateVehicleType,
  deleteVehicleType,
};
