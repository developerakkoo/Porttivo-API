const VehicleType = require('../models/VehicleType');
const VehicleTypeRequest = require('../models/VehicleTypeRequest');
const Vehicle = require('../models/Vehicle');
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability');

const normalizeVehicleTypeName = (name) => {
  if (name == null) return '';
  return name.toString().trim().replace(/\s+/g, ' ');
};

const normalizedNameKey = (name) => normalizeVehicleTypeName(name).toUpperCase();

const serializeType = (doc) => ({
  id: doc._id?.toString?.() || doc.id,
  name: doc.name,
  code: doc.code || null,
  description: doc.description || null,
  isActive: doc.isActive !== false,
  sortOrder: doc.sortOrder ?? 0,
});

const listActiveTypes = async ({ q } = {}) => {
  const query = { isActive: { $ne: false } };
  if (q && q.toString().trim()) {
    const escaped = q.toString().trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.name = { $regex: escaped, $options: 'i' };
  }

  const types = await VehicleType.find(query)
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  return types.map(serializeType);
};

const listAllTypes = async () => {
  const types = await VehicleType.find().sort({ sortOrder: 1, name: 1 }).lean();
  return types.map(serializeType);
};

const assertVehicleTypeAllowed = async (
  name,
  { requireActive = true, transporterId = null, allowOwnPending = false } = {}
) => {
  const trimmed = normalizeVehicleTypeName(name);
  if (!trimmed) {
    return { ok: false, message: 'vehicleType is required' };
  }

  const query = { name: trimmed };
  if (requireActive) {
    query.isActive = { $ne: false };
  }

  const vt = await VehicleType.findOne(query);
  if (vt) {
    return { ok: true, name: trimmed, vehicleType: vt };
  }

  if (allowOwnPending && transporterId) {
    const pending = await VehicleTypeRequest.findOne({
      submittedByTransporterId: transporterId,
      status: 'pending',
      normalizedName: normalizedNameKey(trimmed),
    });
    if (pending) {
      return { ok: true, name: pending.requestedName, pending: true };
    }
  }

  return { ok: false, message: 'Invalid vehicle type' };
};

const getUsageCounts = async (typeName) => {
  const [vehicleCount, postCount] = await Promise.all([
    Vehicle.countDocuments({ vehicleType: typeName }),
    VehicleRouteAvailability.countDocuments({ vehicleType: typeName }),
  ]);
  return { vehicleCount, postCount, total: vehicleCount + postCount };
};

module.exports = {
  normalizeVehicleTypeName,
  normalizedNameKey,
  serializeType,
  listActiveTypes,
  listAllTypes,
  assertVehicleTypeAllowed,
  getUsageCounts,
};
