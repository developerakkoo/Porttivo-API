const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/loadWithMocks');

const servicePath = path.resolve(__dirname, '..', 'src', 'services', 'transporterCustomer.service.js');

const loadService = (overrides = {}) =>
  loadWithMocks(servicePath, {
    '../models/TransporterCustomer': overrides.TransporterCustomer || {},
  });

test('createCustomer creates a normalized customer record', async () => {
  const created = [];
  const service = loadService({
    TransporterCustomer: {
      findOne: async () => null,
      create: async (data) => {
        created.push(data);
        return { _id: 'cust-1', ...data };
      },
    },
  });

  const result = await service.createCustomer('transporter-1', '  Acme Logistics  ');
  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  assert.equal(created[0].name, 'Acme Logistics');
  assert.equal(created[0].normalizedName, 'ACME LOGISTICS');
});

test('listCustomers filters by search query', async () => {
  let capturedQuery = null;
  const service = loadService({
    TransporterCustomer: {
      find: (query) => {
        capturedQuery = query;
        return {
          sort: () => ({
            limit: () => ({
              lean: async () => [{ _id: 'cust-1', transporterId: 'transporter-1', name: 'Acme', normalizedName: 'ACME', lastUsedAt: new Date() }],
            }),
          }),
        };
      },
    },
  });

  const results = await service.listCustomers('transporter-1', 'acme');
  assert.equal(results.length, 1);
  assert.equal(capturedQuery.transporterId, 'transporter-1');
  assert.match(capturedQuery.normalizedName.$regex, /acme/i);
});

test('upsertCustomerLastUsed updates lastUsedAt', async () => {
  let updateQuery = null;
  const service = loadService({
    TransporterCustomer: {
      findOneAndUpdate: async (query, update, options) => {
        updateQuery = { query, update, options };
        return { _id: 'cust-1', name: 'Acme Logistics', normalizedName: 'ACME LOGISTICS' };
      },
    },
  });

  const result = await service.upsertCustomerLastUsed('transporter-1', 'Acme Logistics');
  assert.ok(result);
  assert.equal(updateQuery.query.transporterId, 'transporter-1');
  assert.equal(updateQuery.query.normalizedName, 'ACME LOGISTICS');
  assert.equal(updateQuery.options.upsert, true);
});
