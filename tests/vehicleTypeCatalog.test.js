const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadWithMocks } = require('./helpers/loadWithMocks');

const catalogPath = path.resolve(process.cwd(), 'src/services/vehicleTypeCatalog.service.js');
const controllerPath = path.resolve(process.cwd(), 'src/controllers/vehicleType.controller.js');

const loadCatalogService = (overrides = {}) =>
  loadWithMocks(catalogPath, {
    '../models/VehicleType': overrides.VehicleType || {},
    '../models/VehicleTypeRequest': overrides.VehicleTypeRequest || {},
    '../models/Vehicle': overrides.Vehicle || {},
    '../models/VehicleRouteAvailability': overrides.VehicleRouteAvailability || overrides.VehiclePost || {},
  });

test('listActiveTypes returns only active types sorted', async () => {
  const catalog = loadCatalogService({
    VehicleType: {
      find: (query) => ({
        sort: () => ({
          lean: async () => {
            assert.equal(query.isActive.$ne, false);
            return [
              { _id: '2', name: '40FT', sortOrder: 2, isActive: true },
              { _id: '1', name: '20FT', sortOrder: 1, isActive: true },
            ];
          },
        }),
      }),
    },
  });

  const results = await catalog.listActiveTypes();
  assert.equal(results.length, 2);
  assert.equal(results[0].name, '40FT');
  assert.equal(results[0].isActive, true);
});

test('assertVehicleTypeAllowed rejects empty name', async () => {
  const catalog = loadCatalogService();
  const result = await catalog.assertVehicleTypeAllowed('');
  assert.equal(result.ok, false);
  assert.match(result.message, /required/i);
});

test('assertVehicleTypeAllowed accepts active catalog type', async () => {
  const catalog = loadCatalogService({
    VehicleType: {
      findOne: async (query) => {
        assert.equal(query.name, '20FT');
        assert.equal(query.isActive.$ne, false);
        return { _id: '1', name: '20FT', isActive: true };
      },
    },
  });

  const result = await catalog.assertVehicleTypeAllowed('20FT');
  assert.equal(result.ok, true);
  assert.equal(result.name, '20FT');
});

test('assertVehicleTypeAllowed rejects inactive type when requireActive', async () => {
  const catalog = loadCatalogService({
    VehicleType: {
      findOne: async () => null,
    },
  });

  const result = await catalog.assertVehicleTypeAllowed('OldType');
  assert.equal(result.ok, false);
});

test('getUsageCounts sums vehicle and post references', async () => {
  const catalog = loadCatalogService({
    Vehicle: {
      countDocuments: async (query) => {
        assert.equal(query.vehicleType, 'Trailer');
        return 3;
      },
    },
    VehicleRouteAvailability: {
      countDocuments: async (query) => {
        assert.equal(query.vehicleType, 'Trailer');
        return 2;
      },
    },
  });

  const usage = await catalog.getUsageCounts('Trailer');
  assert.equal(usage.vehicleCount, 3);
  assert.equal(usage.postCount, 2);
  assert.equal(usage.total, 5);
});

test('deleteVehicleType blocks when usage exists', async () => {
  const calls = { deleted: false };
  const controller = loadWithMocks(controllerPath, {
    '../models/VehicleType': {
      findById: async () => ({ _id: 'vt1', name: '20FT' }),
      deleteOne: async () => {
        calls.deleted = true;
      },
    },
    '../services/vehicleTypeCatalog.service': {
      serializeType: (doc) => ({ id: doc._id, name: doc.name }),
      listActiveTypes: async () => [],
      listAllTypes: async () => [],
      getUsageCounts: async () => ({ vehicleCount: 1, postCount: 0, total: 1 }),
    },
  });

  const req = { params: { id: 'vt1' } };
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

  await controller.deleteVehicleType(req, res, () => {});
  assert.equal(res.statusCode, 409);
  assert.equal(calls.deleted, false);
  assert.match(res.body.message, /deactivate/i);
});

test('listPublicVehicleTypes denies company user without manageVehicles', async () => {
  const controller = loadWithMocks(controllerPath, {
    '../models/VehicleType': {},
    '../services/vehicleTypeCatalog.service': {
      listActiveTypes: async () => [{ id: '1', name: '20FT' }],
    },
  });

  const req = { user: { userType: 'company-user', permissions: ['viewTrips'] } };
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

  await controller.listPublicVehicleTypes(req, res, () => {});
  assert.equal(res.statusCode, 403);
});

test('listPublicVehicleTypes returns active types for transporter', async () => {
  const controller = loadWithMocks(controllerPath, {
    '../models/VehicleType': {},
    '../services/vehicleTypeCatalog.service': {
      listActiveTypes: async () => [{ id: '1', name: '20FT', code: '20FT' }],
    },
  });

  const req = { user: { userType: 'transporter' }, query: {} };
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

  await controller.listPublicVehicleTypes(req, res, () => {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.results[0].name, '20FT');
});
