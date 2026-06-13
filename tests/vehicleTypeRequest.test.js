const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadWithMocks } = require('./helpers/loadWithMocks');

const catalogPath = path.resolve(process.cwd(), 'src/services/vehicleTypeCatalog.service.js');
const requestServicePath = path.resolve(process.cwd(), 'src/services/vehicleTypeRequest.service.js');
const requestControllerPath = path.resolve(
  process.cwd(),
  'src/controllers/vehicleTypeRequest.controller.js'
);

const loadCatalogService = (overrides = {}) =>
  loadWithMocks(catalogPath, {
    '../models/VehicleType': overrides.VehicleType || {},
    '../models/VehicleTypeRequest': overrides.VehicleTypeRequest || {},
    '../models/Vehicle': overrides.Vehicle || {},
    '../models/VehicleRouteAvailability': overrides.VehicleRouteAvailability || {},
  });

const loadRequestService = (overrides = {}) =>
  loadWithMocks(requestServicePath, {
    '../models/VehicleType': overrides.VehicleType || {},
    '../models/VehicleTypeRequest': overrides.VehicleTypeRequest || {},
    '../models/Transporter': overrides.Transporter || {},
    '../services/vehicleTypeCatalog.service': overrides.catalog || {
      normalizeVehicleTypeName: (name) => name?.toString?.()?.trim?.()?.replace(/\s+/g, ' ') || '',
      normalizedNameKey: (name) =>
        (name?.toString?.()?.trim?.()?.replace(/\s+/g, ' ') || '').toUpperCase(),
      serializeType: (doc) => ({ id: doc._id, name: doc.name, isActive: doc.isActive !== false }),
    },
  });

test('assertVehicleTypeAllowed accepts own pending request', async () => {
  const catalog = loadCatalogService({
    VehicleType: {
      findOne: async () => null,
    },
    VehicleTypeRequest: {
      findOne: async (query) => {
        assert.equal(query.status, 'pending');
        assert.equal(query.normalizedName, 'CUSTOM BOX');
        return { requestedName: 'Custom Box', status: 'pending' };
      },
    },
  });

  const result = await catalog.assertVehicleTypeAllowed('Custom Box', {
    transporterId: 't1',
    allowOwnPending: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.name, 'Custom Box');
  assert.equal(result.pending, true);
});

test('assertVehicleTypeAllowed rejects pending type for other transporter', async () => {
  const catalog = loadCatalogService({
    VehicleType: {
      findOne: async () => null,
    },
    VehicleTypeRequest: {
      findOne: async () => null,
    },
  });

  const result = await catalog.assertVehicleTypeAllowed('Custom Box', {
    transporterId: 'other',
    allowOwnPending: true,
  });
  assert.equal(result.ok, false);
});

test('submitVehicleTypeRequest creates pending request', async () => {
  const created = [];
  const service = loadRequestService({
    VehicleType: {
      findOne: async () => null,
    },
    VehicleTypeRequest: {
      findOne: async () => null,
      create: async (data) => {
        created.push(data);
        return { _id: 'req1', ...data, status: 'pending', createdAt: new Date() };
      },
    },
  });

  const result = await service.submitVehicleTypeRequest({
    name: '  Custom Flatbed  ',
    transporterId: 't1',
    userId: 'u1',
    userType: 'transporter',
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(created[0].requestedName, 'Custom Flatbed');
  assert.equal(created[0].normalizedName, 'CUSTOM FLATBED');
});

test('submitVehicleTypeRequest rejects duplicate pending name globally', async () => {
  const service = loadRequestService({
    VehicleType: {
      findOne: async () => null,
    },
    VehicleTypeRequest: {
      findOne: async () => ({
        submittedByTransporterId: { toString: () => 'other' },
      }),
    },
  });

  const result = await service.submitVehicleTypeRequest({
    name: 'Custom Flatbed',
    transporterId: 't1',
    userId: 'u1',
    userType: 'transporter',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('submitVehicleTypeRequest rejects active catalog match', async () => {
  const service = loadRequestService({
    VehicleType: {
      findOne: async (query) => {
        assert.equal(query.name, '20FT Trailer');
        return { name: '20FT Trailer', isActive: true };
      },
    },
  });

  const result = await service.submitVehicleTypeRequest({
    name: '20FT Trailer',
    transporterId: 't1',
    userId: 'u1',
    userType: 'transporter',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('approveVehicleTypeRequest creates master catalog entry', async () => {
  const savedRequests = [];
  const service = loadRequestService({
    VehicleType: {
      findOne: (query) => {
        if (query && query.name) {
          return Promise.resolve(null);
        }
        return {
          sort: () => ({
            select: () => ({
              lean: async () => ({ sortOrder: 15 }),
            }),
          }),
        };
      },
      findById: async () => null,
      create: async (data) => ({ _id: 'vt1', ...data, isActive: true }),
    },
    VehicleTypeRequest: {
      findById: async () => ({
        _id: 'req1',
        requestedName: 'Custom Flatbed',
        normalizedName: 'CUSTOM FLATBED',
        status: 'pending',
        save: async function save() {
          savedRequests.push(this);
        },
      }),
    },
    catalog: {
      normalizeVehicleTypeName: (name) => name?.toString?.()?.trim?.() || '',
      normalizedNameKey: (name) => name?.toString?.()?.trim?.()?.toUpperCase() || '',
      serializeType: (doc) => ({ id: doc._id, name: doc.name, isActive: true }),
    },
  });

  const result = await service.approveVehicleTypeRequest('req1', 'admin1');
  assert.equal(result.ok, true);
  assert.equal(result.vehicleType.name, 'Custom Flatbed');
  assert.equal(savedRequests[0].status, 'approved');
  assert.equal(savedRequests[0].approvedVehicleTypeId, 'vt1');
});

test('rejectVehicleTypeRequest marks request rejected', async () => {
  const savedRequests = [];
  const service = loadRequestService({
    VehicleTypeRequest: {
      findById: async () => ({
        _id: 'req1',
        status: 'pending',
        save: async function save() {
          savedRequests.push(this);
        },
      }),
    },
  });

  const result = await service.rejectVehicleTypeRequest('req1', 'admin1', 'Duplicate');
  assert.equal(result.ok, true);
  assert.equal(savedRequests[0].status, 'rejected');
  assert.equal(savedRequests[0].rejectionReason, 'Duplicate');
});

test('submitRequest controller returns 403 without transporter context', async () => {
  const controller = loadWithMocks(requestControllerPath, {
    '../middleware/permission.middleware': {
      getTransporterId: () => null,
    },
    '../services/vehicleTypeRequest.service': {
      submitVehicleTypeRequest: async () => ({ ok: true, status: 201 }),
      serializeRequest: (doc) => doc,
    },
  });

  const req = {
    user: { userType: 'transporter', id: 'u1' },
    body: { name: 'Custom Box' },
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  await controller.submitRequest(req, res, () => {});
  assert.equal(res.statusCode, 403);
});
