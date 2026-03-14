const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

const loadAdminController = (overrides = {}) =>
  loadWithMocks('../src/controllers/admin.controller.js', {
    '../models/Admin': {},
    '../models/Transporter': {},
    '../models/Driver': {},
    '../models/PumpOwner': {},
    '../models/PumpStaff': {},
    '../models/CompanyUser': {},
    '../models/Customer': {},
    '../models/Trip': {},
    '../models/Vehicle': {},
    '../models/FuelTransaction': {},
    '../models/Settlement': {},
    '../models/Wallet': {},
    '../models/SystemConfig': {},
    '../models/AdminAuditLog': {},
    '../services/jwt.service': { generateTokens: () => ({}) },
    '../utils/tripState': {
      TRIP_STATUS: { ACTIVE: 'ACTIVE', POD_PENDING: 'POD_PENDING', CANCELLED: 'CANCELLED' },
      CLOSED_TRIP_STATUSES: ['CLOSED_WITH_POD', 'CLOSED_WITHOUT_POD'],
    },
    '../services/adminAudit.service': {
      logAdminAction: async () => {},
    },
    ...overrides,
  });

test('mergeCustomers reassigns trips and removes source customer', async () => {
  const calls = {
    tripsUpdate: null,
    deletedCustomer: null,
    audit: null,
  };

  const sourceCustomer = { _id: 'customer-source', email: 'a@test.com', name: 'Alpha', isRegistered: true };
  const targetCustomer = {
    _id: 'customer-target',
    email: null,
    name: 'Alpha Logistics',
    isRegistered: false,
    async save() {
      return this;
    },
  };

  const controller = loadAdminController({
    '../models/Customer': {
      findById: async (id) => {
        if (id === 'customer-source') return sourceCustomer;
        if (id === 'customer-target') return targetCustomer;
        return null;
      },
      findByIdAndDelete: async (id) => {
        calls.deletedCustomer = id;
      },
    },
    '../models/Trip': {
      updateMany: async (query, update) => {
        calls.tripsUpdate = { query, update };
        return { modifiedCount: 4 };
      },
    },
    '../services/adminAudit.service': {
      logAdminAction: async (payload) => {
        calls.audit = payload;
      },
    },
  });

  const req = {
    body: { sourceCustomerId: 'customer-source', targetCustomerId: 'customer-target' },
    user: { id: 'admin-1' },
  };
  const res = createMockRes();

  await controller.mergeCustomers(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.deletedCustomer, 'customer-source');
  assert.deepEqual(calls.tripsUpdate.query, { customerId: 'customer-source' });
  assert.equal(targetCustomer.email, 'a@test.com');
  assert.equal(targetCustomer.isRegistered, true);
  assert.equal(calls.audit.action, 'CUSTOMER_MERGED');
});

test('updateMilestoneRules persists admin toggles and audits the change', async () => {
  let saved = false;
  let auditPayload = null;

  const config = {
    _id: 'config-1',
    milestoneRules: {
      toObject: () => ({
        containerPickedRequired: false,
        podRequiredForBillable: true,
      }),
    },
    async save() {
      saved = true;
      return this;
    },
  };

  const controller = loadAdminController({
    '../models/SystemConfig': {
      findOne: async () => config,
      create: async () => config,
    },
    '../services/adminAudit.service': {
      logAdminAction: async (payload) => {
        auditPayload = payload;
      },
    },
  });

  const req = {
    body: { containerPickedRequired: true, podRequiredForBillable: false },
    user: { id: 'admin-1' },
  };
  const res = createMockRes();

  await controller.updateMilestoneRules(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(saved, true);
  assert.equal(config.updatedBy, 'admin-1');
  assert.equal(config.milestoneRules.containerPickedRequired, true);
  assert.equal(config.milestoneRules.podRequiredForBillable, false);
  assert.equal(auditPayload.action, 'MILESTONE_RULES_UPDATED');
});
