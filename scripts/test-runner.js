const assert = require('node:assert/strict');
const path = require('node:path');
const mongoose = require('mongoose');
const { loadWithMocks } = require('../tests/helpers/loadWithMocks');
const { createMockRes } = require('../tests/helpers/http');
const paymentScreenTests = require('../tests/paymentScreen.test');

const buildTripCreateController = (overrides = {}) =>
  loadWithMocks(path.resolve(process.cwd(), 'src/controllers/trip.controller.js'), {
    '../models/Trip': overrides.Trip,
    '../models/Vehicle': overrides.Vehicle,
    '../models/Driver': overrides.Driver,
    '../models/Customer': {},
    '../models/Transporter': {},
    '../models/Notification': { create: async () => ({}) },
    '../models/SystemConfig': {
      findOne: () => ({
        select: async () => null,
      }),
    },
    '../utils/vehicleValidation': {
      checkVehicleHasAssignedTrip: async () => false,
      normalizeIndianVehicleRegistration: (value) => value,
      isValidIndianVehicleRegistration: () => true,
    },
    '../utils/tripResourceState': {
      markTripResourcesBusy: async () => {},
      releaseTripResources: async () => {},
      syncTripResourceBusyState: async () => {},
    },
    '../utils/tripState': {
      TRIP_STATUS: {
        ACCEPTED: 'ACCEPTED',
        PLANNED: 'PLANNED',
        ACTIVE: 'ACTIVE',
        PAUSED: 'PAUSED',
        BOOKED: 'BOOKED',
        POD_PENDING: 'POD_PENDING',
        CLOSED_WITH_POD: 'CLOSED_WITH_POD',
        CLOSED_WITHOUT_POD: 'CLOSED_WITHOUT_POD',
        CANCELLED: 'CANCELLED',
      },
      BOOKING_STATUS: { OPEN: 'OPEN', ASSIGNED: 'ASSIGNED' },
      TRIP_STATUS_VALUES: [],
      TRIP_TYPE_VALUES: ['IMPORT', 'EXPORT', 'LOCAL'],
    },
    '../services/socket.service': {
      emitTripCreated: () => {},
      emitTripCreatedForCustomer: () => {},
      emitBookingAccepted: () => {},
      emitBookingRejected: () => {},
      emitTripVehicleAssigned: () => {},
      emitTripDriverAssigned: () => {},
      emitTripAssigned: () => {},
      emitTripCancelled: () => {},
      emitTripUpdated: () => {},
    },
    '../middleware/permission.middleware': {
      getTransporterId: () => 'transporter-1',
      hasPermission: () => true,
    },
    '../services/tripAccess.service': {
      canBookingBuyerViewTrip: async () => false,
      getMarketplaceTripMetaForUser: async () => null,
      getMarketplaceTripMetaForViewerId: async () => null,
      transporterPartyScopeCondition: () => ({}),
    },
    '../services/wati.service': {
      sendTripCreatedConfirmation: async () => {},
      sendBookingAcceptedTemplate: async () => {},
      sendDriverVehicleAssignedTemplate: async () => {},
      sendBookingRejectedTemplate: async () => {},
      sendBookingRequestReceivedTemplate: async () => {},
    },
    '../services/savedLocation.service': {
      syncTripLocationsToSavedCatalog: async () => {},
    },
    '../services/tripVisibility.service': {
      buildVisibleTrip: (trip) => trip,
    },
  });

const tests = [
  ...paymentScreenTests,
  {
    name: 'trip creation auto-fills driver when vehicle is selected',
    async run() {
      let createdTrip = null;

      class MockTrip {
        constructor(payload) {
          Object.assign(this, payload);
          createdTrip = this;
        }
        async save() {
          return this;
        }
        async populate() {
          return this;
        }
      }
      MockTrip.findOne = async () => null;

      const vehicleDoc = {
        _id: 'vehicle-1',
        transporterId: 'transporter-1',
        ownerType: 'OWN',
        status: 'active',
        driverId: 'driver-1',
        select: async () => ({ isBusy: false }),
      };

      const controller = buildTripCreateController({
        Trip: MockTrip,
        Vehicle: {
          findById: (id) => {
            if (id === 'vehicle-1') return vehicleDoc;
            return { select: async () => ({ isBusy: false }) };
          },
          find: () => ({
            select: () => ({
              limit: async () => [],
            }),
          }),
        },
        Driver: {
          findById: async (id) => {
            if (id === 'driver-1') {
              return {
                _id: 'driver-1',
                transporterId: 'transporter-1',
                status: 'active',
                isBusy: false,
              };
            }
            return null;
          },
        },
      });

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        body: {
          vehicleId: 'vehicle-1',
          tripType: 'IMPORT',
          customerName: 'Acme Ltd',
          containerNumber: 'ABCD123456',
          pickupLocation: {
            formattedAddress: 'Pickup',
            coordinates: [72.8777, 19.076],
          },
          dropLocation: {
            formattedAddress: 'Drop',
            coordinates: [72.8777, 19.076],
          },
        },
      };
      const res = createMockRes();

      await controller.createTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 201);
      assert.equal(createdTrip.vehicleId, 'vehicle-1');
      assert.equal(createdTrip.driverId, 'driver-1');
      assert.ok(createdTrip.assignedAt instanceof Date);
    },
  },
  {
    name: 'trip creation auto-fills vehicle when driver is selected',
    async run() {
      let createdTrip = null;

      class MockTrip {
        constructor(payload) {
          Object.assign(this, payload);
          createdTrip = this;
        }
        async save() {
          return this;
        }
        async populate() {
          return this;
        }
      }
      MockTrip.findOne = async () => null;

      const linkedVehicle = {
        _id: 'vehicle-1',
        vehicleNumber: 'MH03EX1234',
        transporterId: 'transporter-1',
        ownerType: 'OWN',
        status: 'active',
      };

      const controller = buildTripCreateController({
        Trip: MockTrip,
        Vehicle: {
          findById: (id) => {
            if (id === 'vehicle-1') {
              return {
                ...linkedVehicle,
                select: async () => ({ isBusy: false }),
              };
            }
            return { select: async () => ({ isBusy: false }) };
          },
          find: (query) => ({
            select: () => ({
              limit: async () => {
                if (String(query.driverId) === 'driver-1') {
                  return [linkedVehicle];
                }
                return [];
              },
            }),
          }),
        },
        Driver: {
          findById: async (id) => {
            if (id === 'driver-1') {
              return {
                _id: 'driver-1',
                transporterId: 'transporter-1',
                status: 'active',
                isBusy: false,
              };
            }
            return null;
          },
        },
      });

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        body: {
          driverId: 'driver-1',
          tripType: 'IMPORT',
          customerName: 'Acme Ltd',
          containerNumber: 'ABCD123456',
          pickupLocation: {
            formattedAddress: 'Pickup',
            coordinates: [72.8777, 19.076],
          },
          dropLocation: {
            formattedAddress: 'Drop',
            coordinates: [72.8777, 19.076],
          },
        },
      };
      const res = createMockRes();

      await controller.createTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 201);
      assert.equal(createdTrip.vehicleId, 'vehicle-1');
      assert.equal(createdTrip.driverId, 'driver-1');
      assert.ok(createdTrip.assignedAt instanceof Date);
    },
  },
  {
    name: 'trip creation rejects mismatched vehicle and driver',
    async run() {
      class MockTrip {
        constructor(payload) {
          Object.assign(this, payload);
        }
        async save() {
          return this;
        }
        async populate() {
          return this;
        }
      }
      MockTrip.findOne = async () => null;

      const controller = buildTripCreateController({
        Trip: MockTrip,
        Vehicle: {
          findById: (id) => {
            if (id === 'vehicle-1') {
              return {
                _id: 'vehicle-1',
                transporterId: 'transporter-1',
                ownerType: 'OWN',
                status: 'active',
                driverId: 'driver-1',
                select: async () => ({ isBusy: false }),
              };
            }
            return { select: async () => ({ isBusy: false }) };
          },
          find: () => ({
            select: () => ({
              limit: async () => [],
            }),
          }),
        },
        Driver: {
          findById: async (id) => {
            if (id === 'driver-1') {
              return {
                _id: 'driver-1',
                transporterId: 'transporter-1',
                status: 'active',
                isBusy: false,
              };
            }
            if (id === 'driver-2') {
              return {
                _id: 'driver-2',
                transporterId: 'transporter-1',
                status: 'active',
                isBusy: false,
              };
            }
            return null;
          },
        },
      });

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        body: {
          vehicleId: 'vehicle-1',
          driverId: 'driver-2',
          tripType: 'IMPORT',
          customerName: 'Acme Ltd',
          containerNumber: 'ABCD123456',
          pickupLocation: {
            formattedAddress: 'Pickup',
            coordinates: [72.8777, 19.076],
          },
          dropLocation: {
            formattedAddress: 'Drop',
            coordinates: [72.8777, 19.076],
          },
        },
      };
      const res = createMockRes();

      await controller.createTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /different driver/i);
    },
  },
  {
    name: 'trip creation rejects a driver without a linked vehicle',
    async run() {
      class MockTrip {
        constructor(payload) {
          Object.assign(this, payload);
        }
        async save() {
          return this;
        }
        async populate() {
          return this;
        }
      }
      MockTrip.findOne = async () => null;

      const controller = buildTripCreateController({
        Trip: MockTrip,
        Vehicle: {
          findById: () => ({ select: async () => ({ isBusy: false }) }),
          find: () => ({
            select: () => ({
              limit: async () => [],
            }),
          }),
        },
        Driver: {
          findById: async (id) => {
            if (id === 'driver-1') {
              return {
                _id: 'driver-1',
                transporterId: 'transporter-1',
                status: 'active',
                isBusy: false,
              };
            }
            return null;
          },
        },
      });

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        body: {
          driverId: 'driver-1',
          tripType: 'IMPORT',
          customerName: 'Acme Ltd',
          containerNumber: 'ABCD123456',
          pickupLocation: {
            formattedAddress: 'Pickup',
            coordinates: [72.8777, 19.076],
          },
          dropLocation: {
            formattedAddress: 'Drop',
            coordinates: [72.8777, 19.076],
          },
        },
      };
      const res = createMockRes();

      await controller.createTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /does not have a vehicle assigned/i);
    },
  },
  {
    name: 'trip creation rejects a vehicle without an assigned driver',
    async run() {
      class MockTrip {
        constructor(payload) {
          Object.assign(this, payload);
        }
        async save() {
          return this;
        }
        async populate() {
          return this;
        }
      }
      MockTrip.findOne = async () => null;

      const controller = buildTripCreateController({
        Trip: MockTrip,
        Vehicle: {
          findById: (id) => {
            if (id === 'vehicle-1') {
              return {
                _id: 'vehicle-1',
                transporterId: 'transporter-1',
                ownerType: 'OWN',
                status: 'active',
                driverId: null,
                select: async () => ({ isBusy: false }),
              };
            }
            return { select: async () => ({ isBusy: false }) };
          },
          find: () => ({
            select: () => ({
              limit: async () => [],
            }),
          }),
        },
        Driver: {
          findById: async (id) => {
            if (id === 'driver-1') {
              return {
                _id: 'driver-1',
                transporterId: 'transporter-1',
                status: 'active',
                isBusy: false,
              };
            }
            return null;
          },
        },
      });

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        body: {
          vehicleId: 'vehicle-1',
          tripType: 'IMPORT',
          customerName: 'Acme Ltd',
          containerNumber: 'ABCD123456',
          pickupLocation: {
            formattedAddress: 'Pickup',
            coordinates: [72.8777, 19.076],
          },
          dropLocation: {
            formattedAddress: 'Drop',
            coordinates: [72.8777, 19.076],
          },
        },
      };
      const res = createMockRes();

      await controller.createTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /does not have a driver assigned/i);
    },
  },
  {
    name: 'shared validation enforces container number format',
    run() {
      const {
        normalizeContainerNumber,
        validateContainerNumber,
      } = require('../src/utils/validation');

      assert.equal(normalizeContainerNumber(' abcd123456 '), 'ABCD123456');
      assert.equal(validateContainerNumber('ABCD123456'), true);
      assert.equal(validateContainerNumber('AB12CD3456'), false);
      assert.equal(validateContainerNumber('ABCDE12345'), false);
    },
  },
  {
    name: 'customer trip booking rejects invalid container number format',
    async run() {
      const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/trip.controller.js'), {
        '../models/Trip': {
          create: async () => {
            throw new Error('Trip should not be created for invalid container numbers');
          },
        },
        '../models/Vehicle': {},
        '../models/Driver': {},
        '../models/Customer': {
          findById: async () => ({
            _id: 'customer-1',
            name: 'Test Customer',
            mobile: '9876543210',
          }),
        },
        '../models/Transporter': {
          find: async () => [],
        },
        '../models/Notification': {
          create: async () => ({}),
        },
        '../models/SystemConfig': {
          findOne: async () => null,
        },
        '../utils/vehicleValidation': {
          checkVehicleHasAssignedTrip: async () => false,
          normalizeIndianVehicleRegistration: (value) => value,
          isValidIndianVehicleRegistration: () => true,
        },
        '../utils/tripResourceState': {
          markTripResourcesBusy: async () => {},
          releaseTripResources: async () => {},
          syncTripResourceBusyState: async () => {},
        },
        '../utils/tripState': {
          TRIP_STATUS: {
            ACCEPTED: 'ACCEPTED',
            PLANNED: 'PLANNED',
            ACTIVE: 'ACTIVE',
            PAUSED: 'PAUSED',
            BOOKED: 'BOOKED',
            POD_PENDING: 'POD_PENDING',
            CLOSED_WITH_POD: 'CLOSED_WITH_POD',
            CLOSED_WITHOUT_POD: 'CLOSED_WITHOUT_POD',
            CANCELLED: 'CANCELLED',
          },
          BOOKING_STATUS: { OPEN: 'OPEN', ASSIGNED: 'ASSIGNED' },
          TRIP_STATUS_VALUES: [],
          TRIP_TYPE_VALUES: ['IMPORT', 'EXPORT', 'LOCAL'],
        },
        '../services/socket.service': {
          emitTripCreated: () => {},
          emitTripCreatedForCustomer: () => {},
          emitBookingAccepted: () => {},
          emitBookingRejected: () => {},
          emitTripVehicleAssigned: () => {},
          emitTripDriverAssigned: () => {},
          emitTripAssigned: () => {},
          emitTripCancelled: () => {},
          emitTripUpdated: () => {},
        },
        '../middleware/permission.middleware': {
          getTransporterId: () => 'transporter-1',
          hasPermission: () => true,
        },
        '../services/tripAccess.service': {
          canBookingBuyerViewTrip: async () => false,
          getMarketplaceTripMetaForUser: async () => null,
          getMarketplaceTripMetaForViewerId: async () => null,
          transporterPartyScopeCondition: () => ({}),
        },
        '../services/wati.service': {
          sendTripCreatedConfirmation: async () => {},
          sendBookingAcceptedTemplate: async () => {},
          sendDriverVehicleAssignedTemplate: async () => {},
          sendBookingRejectedTemplate: async () => {},
          sendBookingRequestReceivedTemplate: async () => {},
        },
        '../services/savedLocation.service': {
          syncTripLocationsToSavedCatalog: async () => {},
        },
        '../services/tripVisibility.service': {
          buildVisibleTrip: (trip) => trip,
        },
      });

      const req = {
        user: { id: 'customer-1', userType: 'customer' },
        body: {
          tripType: 'IMPORT',
          containerNumber: 'AB12CD3456',
          pickupLocation: {
            formattedAddress: 'Pickup Address',
            coordinates: [72.8777, 19.076],
          },
          dropLocation: {
            formattedAddress: 'Drop Address',
            coordinates: [72.8777, 19.076],
          },
        },
      };
      const res = createMockRes();

      await controller.bookCustomerTrip(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /container number must be 4 letters followed by 6 digits/i);
    },
  },
  {
    name: 'shared validation normalizes mobile and email and enforces strong password',
    run() {
      const {
        cleanMobile,
        normalizeEmail,
        validateMobile,
        validateEmail,
        validatePassword,
      } = require('../src/utils/validation');

      assert.equal(cleanMobile('+91 98765-43210'), '919876543210');
      assert.equal(normalizeEmail('  Admin@Example.COM '), 'admin@example.com');
      assert.equal(validateMobile('9876543210'), true);
      assert.equal(validateMobile('+91 98765 43210'), false);
      assert.equal(validateEmail('admin@example.com'), true);
      assert.equal(validateEmail('bad-email'), false);
      assert.equal(validatePassword('Weak123'), false);
      assert.equal(validatePassword('StrongPass1!'), true);
    },
  },
  {
    name: 'admin schema rejects weak passwords and invalid emails',
    run() {
      const Admin = require('../src/models/Admin');

      const weakPasswordAdmin = new Admin({
        username: 'admin-weak',
        email: 'weak@example.com',
        password: 'Weak123',
      });
      const weakPasswordError = weakPasswordAdmin.validateSync();

      assert.ok(weakPasswordError);
      assert.match(weakPasswordError.errors.password.message, /uppercase, lowercase, number, and special character/i);

      const invalidEmailAdmin = new Admin({
        username: 'admin-email',
        email: 'invalid-email',
        password: 'StrongPass1!',
      });
      const invalidEmailError = invalidEmailAdmin.validateSync();

      assert.ok(invalidEmailError);
      assert.match(invalidEmailError.errors.email.message, /valid email/i);
    },
  },
  {
    name: 'admin login rejects invalid email before database lookup',
    async run() {
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
        '../models/VehicleRouteAvailability': {},
        '../models/VehicleRouteAssignment': {},
        '../models/VehicleBooking': {},
        '../models/FuelTransaction': {},
        '../models/Settlement': {},
        '../models/Wallet': {},
        '../models/SystemConfig': {},
        '../models/AdminAuditLog': {},
        '../models/AuditLog': {},
        '../models/SavedLocation': {},
        '../services/jwt.service': { generateTokens: () => ({}) },
        '../utils/tripState': {
          TRIP_STATUS: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', PLANNED: 'PLANNED', POD_PENDING: 'POD_PENDING' },
          CLOSED_TRIP_STATUSES: [],
        },
        '../utils/tripResourceState': {
          releaseTripResources: async () => {},
          syncTripResourceBusyState: async () => {},
        },
        '../services/adminAudit.service': { logAdminAction: async () => {} },
        '../services/socket.service': {
          emitTripAssigned: () => {},
          emitTripVehicleAssigned: () => {},
          emitTripDriverAssigned: () => {},
          emitTripCancelled: () => {},
          emitTripClosedWithoutPOD: () => {},
        },
      });

      const req = {
        body: { email: 'not-an-email', password: 'StrongPass1!' },
      };
      const res = createMockRes();

      await controller.adminLogin(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 400);
      assert.match(res.body.message, /invalid email format/i);
    },
  },
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
    name: 'driver tracking service resolves and persists status changes',
    async run() {
      const created = [];
      const service = loadWithMocks(path.resolve(process.cwd(), 'src/services/driverTracking.service.js'), {
        '../models/Notification': {
          create: async payload => {
            created.push(payload);
            return payload;
          },
        },
      });

      assert.equal(
        service.resolveTrackingStatusFromTelemetry({ gpsEnabled: false }),
        service.DRIVER_TRACKING_STATUS.GPS_OFF
      );
      assert.equal(
        service.resolveTrackingStatusFromTelemetry({ networkConnected: false }),
        service.DRIVER_TRACKING_STATUS.OFFLINE
      );
      assert.equal(
        service.resolveTrackingStatusFromTelemetry({ loggedOut: true }),
        service.DRIVER_TRACKING_STATUS.LOGGED_OUT
      );

      const trip = {
        _id: 'trip-1',
        tripId: 'TRIP-1',
        transporterId: 'transporter-1',
        driverId: 'driver-1',
        driverTracking: {
          status: service.DRIVER_TRACKING_STATUS.ONLINE,
          reason: 'tracking_active',
          updatedAt: new Date('2026-05-15T10:00:00.000Z'),
        },
        async save() {
          return this;
        },
      };

      const result = await service.persistTrackingUpdate({
        trip,
        patch: {
          status: service.DRIVER_TRACKING_STATUS.LOGGED_OUT,
          reason: 'driver_requested_logout',
          source: 'auth.logout',
          lastLogoutAt: new Date('2026-05-15T10:05:00.000Z'),
          updatedAt: new Date('2026-05-15T10:05:00.000Z'),
        },
        actor: {
          userId: 'driver-1',
          userType: 'driver',
        },
      });

      assert.equal(result.changed, true);
      assert.equal(trip.driverTracking.status, service.DRIVER_TRACKING_STATUS.LOGGED_OUT);
      assert.equal(created.length, 1);
      assert.equal(created[0].type, 'DRIVER_STATUS');
      assert.equal(created[0].priority, 'high');
      assert.equal(created[0].userType, 'TRANSPORTER');
    },
  },
  {
    name: 'vehicle post slots only decrease on confirmed booking',
    async run() {
      const postState = {
        _id: 'post-1',
        transporterId: 'seller-1',
        status: 'active',
        vehicleType: 'Truck',
        quantity: 2,
        slotsLeft: 2,
        pricePerVehicle: 5000,
        destination: null,
        destinations: [],
        destinationQuantities: [],
        async save() {
          return this;
        },
        populate() {
          return this;
        },
        async lean() {
          return this;
        },
      };

      const bookingState = {
        _id: 'booking-1',
        postId: 'post-1',
        assignmentId: 'assignment-1',
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
        vehicleId: 'vehicle-1',
        lastPriceProposal: { proposedPrice: 4700, proposedBy: 'buyer-1' },
        estimatedPrice: 5000,
        status: 'REQUESTED',
        async save() {
          return this;
        },
        populate() {
          return this;
        },
        async lean() {
          return this;
        },
      };

      const addVehicleController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/vehiclePost.controller.js'),
        {
          mongoose: {
            ...mongoose,
            startSession: async () => ({
              startTransaction: () => {},
              commitTransaction: async () => {},
              abortTransaction: async () => {},
              endSession: () => {},
            }),
          },
          '../models/Vehicle': {
            find: async () => [
              {
                _id: 'vehicle-1',
                transporterId: 'seller-1',
                vehicleType: 'Truck',
                status: 'active',
              },
            ],
          },
          '../models/VehicleRouteAvailability': {
            findById: () => postState,
          },
          '../models/VehicleRouteAssignment': {
            countDocuments: async () => 1,
            find: () => ({
              lean: async () => [],
            }),
            insertMany: async (docs) =>
              docs.map((d, i) => ({
                _id: `assignment-new-${i}`,
                ...d,
              })),
          },
          '../models/VehicleBooking': {},
          '../services/socket.service': {
            getIO: () => ({ emit: () => {} }),
          },
        }
      );

      const addReq = {
        params: { id: 'post-1' },
        body: { vehicleId: 'vehicle-1', price: 5000 },
        user: { id: 'seller-1', userType: 'transporter' },
      };
      const addRes = createMockRes();

      await addVehicleController.addVehicleToPost(addReq, addRes, (error) => {
        throw error;
      });

      assert.equal(addRes.statusCode, 201);
      assert.equal(postState.slotsLeft, 2);
      assert.equal(postState.status, 'active');

      const bookingController = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/vehicleBooking.controller.js'), {
        '../models/Notification': {},
        '../models/VehicleBooking': {
          findById: () => bookingState,
        },
        '../models/VehicleRouteAvailability': {
          findOneAndUpdate: async () => {
            postState.slotsLeft = Math.max(0, postState.slotsLeft - 1);
            if (postState.slotsLeft === 0) {
              postState.status = 'fulfilled';
            }
            return postState;
          },
          findById: () => ({
            session: async () => postState,
          }),
        },
        '../models/VehicleRouteAssignment': {
          findOne: () => ({
            session: async () => ({ _id: 'assignment-1' }),
          }),
          findByIdAndUpdate: async () => ({}),
          countDocuments: async () => 0,
        },
        '../models/TransporterMessage': {
          create: async (payload) => payload,
          updateMany: async () => {},
          find: async () => [],
        },
        '../models/Vehicle': {},
        '../models/Transporter': {},
        '../services/bookingToTrip.service': {
          createTripFromBooking: async (booking) => {
            booking.tripId = 'trip-1';
            return { _id: 'trip-1' };
          },
        },
        '../services/socket.service': {
          getIO: () => ({
            to: () => ({
              emit: () => {},
            }),
            emit: () => {},
          }),
        },
        '../models/VehicleBookingAudit': {
          VehicleBookingAudit: {
            logAction: async () => {},
          },
          BOOKING_AUDIT_ACTIONS: {
            CONFIRMED: 'CONFIRMED',
            REJECTED: 'REJECTED',
            CANCELLED: 'CANCELLED',
            BOOKING_SUBMITTED: 'BOOKING_SUBMITTED',
            PRICE_PROPOSED: 'PRICE_PROPOSED',
            PRICE_ACCEPTED: 'PRICE_ACCEPTED',
            INQUIRY_CREATED: 'INQUIRY_CREATED',
            STATUS_CHANGED: 'STATUS_CHANGED',
          },
        },
        '../utils/transporterActor': {
          getTransporterActorId: () => 'seller-1',
        },
        '../utils/marketplaceChatPayload': {
          buildChatMessageSocketPayload: () => ({}),
        },
        '../utils/marketplaceNotification': {
          buildMarketplaceMessageNotificationFields: () => ({ title: '', message: '', data: {} }),
        },
        'mongoose': {
          ...mongoose,
          startSession: async () => ({
            startTransaction: () => {},
            commitTransaction: async () => {},
            abortTransaction: async () => {},
            endSession: () => {},
          }),
        },
      });

      const confirmReq = {
        params: { id: 'booking-1' },
        user: { id: 'seller-1' },
      };
      const confirmRes = createMockRes();

      await bookingController.acceptBooking(confirmReq, confirmRes, (error) => {
        throw error;
      });

      assert.equal(confirmRes.statusCode, 200);
      assert.equal(postState.slotsLeft, 1);
      assert.equal(postState.status, 'active');
      assert.equal(bookingState.status, 'CONFIRMED');
      assert.equal(bookingState.tripId, 'trip-1');
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
  {
    name: 'liveAssignmentFilter selects non-released assignments',
    run() {
      const { liveAssignmentFilter } = require('../src/utils/liveVehicleAssignment')
      assert.deepEqual(liveAssignmentFilter({ postId: 'abc' }), {
        postId: 'abc',
        isReleased: { $ne: true },
      })
    },
  },
  {
    name: 'filterBookableAssignments excludes confirmed and released rows',
    run() {
      const {
        filterBookableAssignments,
        hasBookableInventory,
      } = require('../src/utils/marketplaceAvailability.util')

      const confirmed = new Set(['assignment-confirmed'])
      const assignments = [
        { _id: 'assignment-open', isReleased: false },
        { _id: 'assignment-confirmed', isReleased: false },
        { _id: 'assignment-released', isReleased: true },
      ]

      const bookable = filterBookableAssignments(assignments, confirmed)
      assert.equal(bookable.length, 1)
      assert.equal(bookable[0]._id, 'assignment-open')
      assert.equal(hasBookableInventory(assignments, confirmed), true)
      assert.equal(
        hasBookableInventory(assignments, new Set(['assignment-open', 'assignment-confirmed', 'assignment-released'])),
        false
      )
    },
  },
  {
    name: 'searchAvailability omits posts without bookable vehicles',
    run() {
      const { filterBookableAssignments } = require('../src/utils/marketplaceAvailability.util')

      const posts = [{ _id: 'post-1' }, { _id: 'post-2' }]
      const assignmentsByPost = {
        'post-1': [{ _id: 'a1', isReleased: true }],
        'post-2': [{ _id: 'a2', isReleased: false }],
      }
      const confirmed = new Set(['a2'])

      const results = posts
        .map(p => {
          const key = p._id.toString()
          const bookable = filterBookableAssignments(
            assignmentsByPost[key] || [],
            confirmed
          )
          return { id: p._id, availableVehicles: bookable }
        })
        .filter(r => r.availableVehicles.length > 0)

      assert.equal(results.length, 0)
    },
  },
  {
    name: 'confirmed single assignment leaves no bookable inventory',
    run() {
      const { hasBookableInventory } = require('../src/utils/marketplaceAvailability.util')
      const assignments = [{ _id: 'only-one', isReleased: false }]
      const confirmed = new Set(['only-one'])
      assert.equal(hasBookableInventory(assignments, confirmed), false)
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
