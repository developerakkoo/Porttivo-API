const TransporterCustomer = require('../models/TransporterCustomer');

const normalizeCustomerName = (name) => {
  if (!name) return '';
  return String(name).trim().replace(/\s+/g, ' ');
};

const normalizedNameKey = (name) => normalizeCustomerName(name).toUpperCase();

const serializeCustomer = (doc) => ({
  id: doc._id?.toString?.() || doc.id,
  transporterId: doc.transporterId?.toString?.() || doc.transporterId,
  name: doc.name,
  normalizedName: doc.normalizedName,
  lastUsedAt: doc.lastUsedAt || null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const validateCustomerName = (name) => {
  const trimmed = normalizeCustomerName(name);
  if (!trimmed) {
    return { ok: false, message: 'Customer name is required' };
  }
  if (trimmed.length > 200) {
    return { ok: false, message: 'Customer name must be 200 characters or less' };
  }
  return { ok: true, name: trimmed, normalizedName: normalizedNameKey(trimmed) };
};

const listCustomers = async (transporterId, q = '') => {
  const query = { transporterId };
  const search = q?.toString?.()?.trim?.();
  if (search) {
    const pattern = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query.normalizedName = { $regex: pattern, $options: 'i' };
  }

  const customers = await TransporterCustomer.find(query)
    .sort({ lastUsedAt: -1, name: 1 })
    .limit(50)
    .lean();

  return customers.map(serializeCustomer);
};

const createCustomer = async (transporterId, name) => {
  const validation = validateCustomerName(name);
  if (!validation.ok) {
    return { ok: false, status: 400, message: validation.message };
  }

  const existing = await TransporterCustomer.findOne({
    transporterId,
    normalizedName: validation.normalizedName,
  });

  if (existing) {
    existing.name = validation.name;
    existing.lastUsedAt = new Date();
    await existing.save();
    return { ok: true, status: 200, customer: existing, message: 'Customer already exists' };
  }

  const customer = await TransporterCustomer.create({
    transporterId,
    name: validation.name,
    normalizedName: validation.normalizedName,
    lastUsedAt: new Date(),
  });

  return { ok: true, status: 201, customer, message: 'Customer created successfully' };
};

const upsertCustomerLastUsed = async (transporterId, customerName) => {
  const validation = validateCustomerName(customerName);
  if (!validation.ok) {
    return null;
  }

  return TransporterCustomer.findOneAndUpdate(
    { transporterId, normalizedName: validation.normalizedName },
    {
      $set: {
        name: validation.name,
        normalizedName: validation.normalizedName,
        lastUsedAt: new Date(),
      },
      $setOnInsert: { transporterId },
    },
    { upsert: true, new: true }
  );
};

module.exports = {
  normalizeCustomerName,
  normalizedNameKey,
  serializeCustomer,
  validateCustomerName,
  listCustomers,
  createCustomer,
  upsertCustomerLastUsed,
};
