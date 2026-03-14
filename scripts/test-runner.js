const assert = require('node:assert/strict');
const path = require('node:path');
const { loadWithMocks } = require('../tests/helpers/loadWithMocks');
const { createMockRes } = require('../tests/helpers/http');

const tests = [
  {
    name: 'customer gets full execution visibility when customer is payer',
    run() {
      const { buildVisibleTrip } = require('../src/services/tripVisibility.service');

      const trip = {
        _id: 'trip-1',
        customerId: 'customer-1',
        status: 'ACTIVE',
        tripType: 'IMPORT',
        customerOwnership: { payerType: 'CUSTOMER' },
        driverId: { _id: 'driver-1', name: 'Driver' },
        transporterId: { _id: 'transporter-1', name: 'Transporter' },
        vehicleId: { _id: 'vehicle-1', vehicleNumber: 'MH01AB1234', trailerType: '40FT' },
        shareConfig: { token: 'secret-token' },
      };

      const result = buildVisibleTrip(trip, {
        actor: { id: 'customer-1', userType: 'customer' },
        accessType: 'direct',
      });

      assert.equal(result.visibilityScope, 'FULL_EXECUTION');
      assert.equal(result.vehicle.vehicleNumber, 'MH01AB1234');
      assert.equal(result.shareConfig.token, undefined);
    },
  },
  {
    name: 'customer gets status-only visibility when transporter is payer',
    run() {
      const { buildVisibleTrip } = require('../src/services/tripVisibility.service');

      const trip = {
        _id: 'trip-2',
        customerId: 'customer-1',
        status: 'ACTIVE',
        tripType: 'EXPORT',
        customerOwnership: { payerType: 'TRANSPORTER' },
        driverId: { _id: 'driver-1', name: 'Driver' },
        pickupLocation: { address: 'Pickup', city: 'Mumbai', state: 'MH' },
        dropLocation: { address: 'Drop', city: 'Pune', state: 'MH' },
        milestones: [{ milestoneNumber: 1, milestoneType: 'CONTAINER_PICKED', timestamp: new Date() }],
      };

      const result = buildVisibleTrip(trip, {
        actor: { id: 'customer-1', userType: 'customer' },
        accessType: 'direct',
      });

      assert.equal(result.visibilityScope, 'STATUS_ONLY');
      assert.equal(result.driverId, undefined);
      assert.equal(result.milestoneTimeline.length, 1);
    },
  },
  {
    name: 'origin pickup shared link only exposes pickup-specific payload',
    run() {
      const { buildVisibleTrip } = require('../src/services/tripVisibility.service');

      const trip = {
        _id: 'trip-3',
        tripId: 'TRIP-3',
        status: 'ACTIVE',
        shareConfig: { linkType: 'ORIGIN_PICKUP', visibilityMode: 'STATUS_ONLY' },
        pickupLocation: { address: 'Pickup yard', city: 'Mumbai', state: 'MH' },
        hiredVehicle: { vehicleNumber: 'MH02CD4567', trailerType: '20FT' },
        milestones: [
          {
            milestoneNumber: 1,
            milestoneType: 'CONTAINER_PICKED',
            timestamp: new Date(),
            location: { latitude: 1, longitude: 2 },
          },
        ],
      };

      const result = buildVisibleTrip(trip, { accessType: 'shared' });

      assert.equal(result.visibilityScope, 'ORIGIN_PICKUP');
      assert.equal(result.originPickup.reached, true);
      assert.equal(result.vehicle.vehicleNumber, 'MH02CD4567');
      assert.equal(result.dropLocation, undefined);
    },
  },
  {
    name: 'debitWallet deducts balance, mirrors wallet, and syncs transporter fuel cards',
    async run() {
      const calls = {
        transporterUpdate: null,
        fuelCardUpdate: null,
        walletTransaction: null,
      };

      const wallet = {
        _id: 'wallet-1',
        userId: 'transporter-1',
        userType: 'TRANSPORTER',
        balance: 1000,
        hasSufficientBalance(amount) {
          return this.balance >= amount;
        },
        async deductBalance(amount) {
          this.balance -= amount;
          return this;
        },
      };

      const service = loadWithMocks(path.resolve(process.cwd(), 'src/services/walletLedger.service.js'), {
        '../models/Wallet': {
          findOne: async () => wallet,
          create: async () => wallet,
        },
        '../models/WalletTransaction': {
          create: async (payload) => {
            calls.walletTransaction = payload;
            return payload;
          },
        },
        '../models/Transporter': {
          findByIdAndUpdate: async (id, update) => {
            calls.transporterUpdate = { id, update };
          },
        },
        '../models/Driver': { findByIdAndUpdate: async () => {} },
        '../models/PumpOwner': { findByIdAndUpdate: async () => {} },
        '../models/FuelCard': {
          updateMany: async (query, update) => {
            calls.fuelCardUpdate = { query, update };
          },
        },
      });

      const result = await service.debitWallet({
        userId: 'transporter-1',
        userType: 'TRANSPORTER',
        amount: 250,
        reference: 'FTX-1',
        referenceType: 'FUEL',
        description: 'Fuel purchase',
      });

      assert.equal(result.wallet.balance, 750);
      assert.equal(calls.transporterUpdate.id, 'transporter-1');
      assert.deepEqual(calls.transporterUpdate.update, { $set: { walletBalance: 750 } });
      assert.deepEqual(calls.fuelCardUpdate.query, { transporterId: 'transporter-1' });
      assert.equal(calls.fuelCardUpdate.update.$set.balance, 750);
      assert.equal(calls.walletTransaction.type, 'DEBIT');
      assert.equal(calls.walletTransaction.balanceAfter, 750);
    },
  },
  {
    name: 'startTrip rejects planned trip without assigned driver',
    async run() {
      const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/tripStatus.controller.js'), {
        '../models/Trip': {
          findById: () => ({
            populate: async () => ({
              _id: 'trip-1',
              transporterId: 'transporter-1',
              vehicleId: { _id: 'vehicle-1', status: 'active' },
              hiredVehicle: null,
              driverId: null,
              status: 'PLANNED',
            }),
          }),
        },
        '../models/Vehicle': {},
        '../models/Driver': {},
        '../utils/vehicleValidation': { checkVehicleHasActiveTrip: async () => false },
        '../utils/milestoneMapping': {
          getMilestoneTypeByNumber: () => 'CONTAINER_PICKED',
          getDriverLabel: () => 'Container Picked',
        },
        '../services/socket.service': {
          emitTripStarted: () => {},
          emitTripCompleted: () => {},
          emitTripPodPending: () => {},
          emitTripClosedWithoutPOD: () => {},
          emitTripAutoActivated: () => {},
        },
        '../services/tripQueue.service': { activateNextTrip: async () => null },
        '../services/wati.service': { sendTripCompletedTemplate: async () => {} },
      });

      const req = {
        params: { id: 'trip-1' },
        user: { id: 'transporter-1', userType: 'transporter' },
      };
      const res = createMockRes();

      await controller.startTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /assigned driver/i);
    },
  },
  {
    name: 'completeTrip moves active trip to POD_PENDING and auto-activates next trip',
    async run() {
      const emits = { podPending: 0, completed: 0, autoActivated: 0 };
      const trip = {
        _id: 'trip-2',
        transporterId: 'transporter-1',
        driverId: 'driver-1',
        customerId: 'customer-1',
        status: 'ACTIVE',
        milestones: [1, 2, 3, 4, 5],
        audit: {},
        areAllMilestonesCompleted: () => true,
        async save() {
          return this;
        },
        async populate() {
          return this;
        },
      };
      const nextTrip = { _id: 'trip-3', driverId: 'driver-1', transporterId: 'transporter-1' };

      const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/tripStatus.controller.js'), {
        '../models/Trip': { findById: async () => trip },
        '../models/Vehicle': {},
        '../models/Driver': {},
        '../utils/vehicleValidation': { checkVehicleHasActiveTrip: async () => false },
        '../utils/milestoneMapping': {
          getMilestoneTypeByNumber: () => 'TRIP_COMPLETED',
          getDriverLabel: () => 'Trip Completed',
        },
        '../services/socket.service': {
          emitTripStarted: () => {},
          emitTripCompleted: () => {
            emits.completed += 1;
          },
          emitTripPodPending: () => {
            emits.podPending += 1;
          },
          emitTripClosedWithoutPOD: () => {},
          emitTripAutoActivated: (emittedTrip) => {
            emits.autoActivated += 1;
            assert.equal(emittedTrip._id, 'trip-3');
          },
        },
        '../services/tripQueue.service': { activateNextTrip: async () => nextTrip },
        '../services/wati.service': { sendTripCompletedTemplate: async () => {} },
      });

      const req = {
        params: { id: 'trip-2' },
        user: { id: 'driver-1', userType: 'driver' },
      };
      const res = createMockRes();

      await controller.completeTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 200);
      assert.equal(trip.status, 'POD_PENDING');
      assert.ok(trip.completedAt instanceof Date);
      assert.ok(trip.podDueAt instanceof Date);
      assert.equal(emits.podPending, 1);
      assert.equal(emits.completed, 1);
      assert.equal(emits.autoActivated, 1);
    },
  },
  {
    name: 'reviewCashReceipt approves cashback and credits driver wallet',
    async run() {
      let creditCall = null;
      const transaction = {
        _id: 'fuel-1',
        transactionId: 'FTX-1',
        transactionType: 'CASH_RECEIPT',
        driverId: 'driver-1',
        transporterId: 'transporter-1',
        vehicleNumber: 'MH01AB1234',
        review: { status: 'PENDING' },
        cashback: { amount: 20, status: 'PENDING' },
        async save() {
          return this;
        },
        async populate() {
          return this;
        },
      };

      const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/fuelTransaction.controller.js'), {
        '../models/FuelTransaction': { findById: async () => transaction },
        '../models/FuelCard': {},
        '../models/Driver': {},
        '../models/Vehicle': {},
        '../services/qrCode.service': {
          generateQRCode: async () => ({}),
          validateQRCode: () => ({}),
          generateTransactionId: () => 'FTX-NEW',
        },
        '../services/fraudDetection.service': { runFraudChecks: async () => ({}) },
        '../middleware/upload.middleware': { upload: {} },
        '../services/walletLedger.service': {
          getOrCreateWallet: async () => ({}),
          debitWallet: async () => ({}),
          creditWallet: async (payload) => {
            creditCall = payload;
            return { transaction: { _id: 'wallet-tx-1' } };
          },
        },
      });

      const req = {
        params: { id: 'fuel-1' },
        body: { action: 'APPROVE', notes: 'Looks valid', creditCashback: true },
        user: { id: 'admin-1', userType: 'admin' },
      };
      const res = createMockRes();

      await controller.reviewCashReceipt(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 200);
      assert.equal(transaction.review.status, 'APPROVED');
      assert.equal(transaction.cashback.status, 'CREDITED');
      assert.equal(transaction.cashback.walletTransactionId, 'wallet-tx-1');
      assert.ok(transaction.cashback.creditedAt instanceof Date);
      assert.equal(creditCall.userId, 'driver-1');
      assert.equal(creditCall.userType, 'DRIVER');
      assert.equal(creditCall.amount, 20);
    },
  },
  {
    name: 'mergeCustomers reassigns trips and removes source customer',
    async run() {
      const calls = { tripsUpdate: null, deletedCustomer: null, audit: null };
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

      const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/admin.controller.js'), {
        '../models/Admin': {},
        '../models/Transporter': {},
        '../models/Driver': {},
        '../models/PumpOwner': {},
        '../models/PumpStaff': {},
        '../models/CompanyUser': {},
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
    },
  },
  {
    name: 'updateMilestoneRules persists admin toggles and audits the change',
    async run() {
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

      const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/admin.controller.js'), {
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
        '../models/SystemConfig': {
          findOne: async () => config,
          create: async () => config,
        },
        '../models/AdminAuditLog': {},
        '../services/jwt.service': { generateTokens: () => ({}) },
        '../utils/tripState': {
          TRIP_STATUS: { ACTIVE: 'ACTIVE', POD_PENDING: 'POD_PENDING', CANCELLED: 'CANCELLED' },
          CLOSED_TRIP_STATUSES: ['CLOSED_WITH_POD', 'CLOSED_WITHOUT_POD'],
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
    },
  },
];

const run = async () => {
  let passed = 0;

  for (const currentTest of tests) {
    try {
      await currentTest.run();
      passed += 1;
      console.log(`PASS ${currentTest.name}`);
    } catch (error) {
      console.error(`FAIL ${currentTest.name}`);
      console.error(error.stack || error.message || error);
      process.exitCode = 1;
    }
  }

  console.log(`\n${passed}/${tests.length} tests passed`);
};

run();
