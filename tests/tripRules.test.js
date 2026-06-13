const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

const noop = async () => {};
const noopSync = () => {};

class TripMock {
  constructor(payload) {
    Object.assign(this, payload);
    this._id = this._id || 'trip-1';
    this.tripId = this.tripId || 'TRIP-MOCK-1';
  }

  async save() {
    return this;
  }

  async populate() {
    return this;
  }

  toObject() {
    return { ...this };
  }

  getCurrentMilestone() {
    return null;
  }
}

TripMock.findOne = async () => null;

const createTripController = (overrides = {}) =>
  loadWithMocks(path.resolve(__dirname, '..', 'src', 'controllers', 'trip.controller.js'), {
    '../models/Trip': TripMock,
    '../models/Vehicle': {
      findById: async () => ({
        _id: 'vehicle-1',
        transporterId: 'transporter-1',
        ownerType: 'OWN',
        status: 'active',
        driverId: 'driver-1',
      }),
      find: () => ({
        select: () => ({
          limit: async () => [{ _id: 'vehicle-1', vehicleNumber: 'MH12AB3434' }],
        }),
      }),
    },
    '../models/Driver': {
      findById: async (id) => ({
        _id: id,
        transporterId: 'transporter-1',
        status: 'active',
      }),
    },
    '../models/Customer': {},
    '../models/Transporter': {},
    '../models/Notification': {},
    '../models/SystemConfig': {
      findOne: () => ({
        select: () => ({ milestoneRules: { containerPickedRequired: false } }),
      }),
    },
    '../utils/vehicleValidation': {
      checkVehicleHasAssignedTrip: async () => false,
      checkVehicleHasActiveTrip: async () => false,
      buildResourceTripQuery: () => ({}),
      normalizeIndianVehicleRegistration: (value) => value,
      isValidIndianVehicleRegistration: () => true,
    },
    '../utils/tripResourceState': {
      markTripResourcesBusy: noop,
      releaseTripResources: noop,
      syncTripResourceBusyState: noop,
    },
    '../services/socket.service': {
      emitTripCreated: noopSync,
      emitTripCreatedForCustomer: noopSync,
      emitBookingAccepted: noopSync,
      emitBookingRejected: noopSync,
      emitTripVehicleAssigned: noopSync,
      emitTripDriverAssigned: noopSync,
      emitTripAssigned: noopSync,
      emitTripCancelled: noopSync,
      emitTripUpdated: noopSync,
    },
    '../middleware/permission.middleware': {
      getTransporterId: () => 'transporter-1',
      hasPermission: () => false,
    },
    '../services/tripAccess.service': {
      canBookingBuyerViewTrip: async () => false,
      getMarketplaceTripMetaForUser: async () => null,
      getMarketplaceTripMetaForViewerId: () => null,
      transporterPartyScopeCondition: () => ({}),
    },
    '../services/wati.service': {
      sendTripCreatedConfirmation: noop,
      sendBookingAcceptedTemplate: noop,
      sendDriverVehicleAssignedTemplate: noop,
      sendBookingRejectedTemplate: noop,
      sendBookingRequestReceivedTemplate: noop,
    },
    '../services/savedLocation.service': {
      syncTripLocationsToSavedCatalog: noop,
    },
    '../services/transporterCustomer.service': {
      upsertCustomerLastUsed: noop,
    },
    '../services/tripQueue.service': {
      assignTripQueueMetadata: async (trip) => trip,
      getTripQueueInfo: async () => ({ queuePosition: null, isQueued: false, blockingTripId: null }),
    },
    './tripStatus.controller': {
      tryAutoStartTrip: async () => null,
    },
    '../services/tripVisibility.service': {
      buildVisibleTrip: (trip) => trip,
    },
    ...overrides,
  });

test('getBackendMeaning supports LOCAL trip types', async () => {
  const { getBackendMeaning } = require('../src/utils/milestoneMapping');

  assert.equal(getBackendMeaning('CONTAINER_PICKED', 'LOCAL'), 'Vehicle dispatched for local movement');
});

test('createTrip rejects missing customer name for transporter-created trips', async () => {
  const controller = createTripController();
  const req = {
    user: { id: 'user-1', userType: 'transporter' },
    body: {
      tripType: 'LOCAL',
    },
  };
  const res = createMockRes();

  await controller.createTrip(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /customer name is required/i);
});

test('createTrip accepts LOCAL trips and queues vehicles with active trips', async () => {
  const savedTrips = [];
  class QueuedTripMock extends TripMock {
    constructor(payload) {
      super(payload);
      savedTrips.push(this);
    }
  }

  const controller = createTripController({
    '../models/Trip': QueuedTripMock,
    '../utils/vehicleValidation': {
      checkVehicleHasAssignedTrip: async () => true,
      checkVehicleHasActiveTrip: async () => true,
      buildResourceTripQuery: () => ({}),
      normalizeIndianVehicleRegistration: (value) => value,
      isValidIndianVehicleRegistration: () => true,
    },
    '../services/tripQueue.service': {
      assignTripQueueMetadata: async (trip) => {
        trip.queueSequence = 2;
        return trip;
      },
      getTripQueueInfo: async () => ({
        queuePosition: 2,
        isQueued: true,
        blockingTripId: 'blocking-trip-1',
      }),
    },
    '../services/transporterCustomer.service': {
      upsertCustomerLastUsed: async () => null,
    },
    './tripStatus.controller': {
      tryAutoStartTrip: async () => null,
    },
  });

  const req = {
    user: { id: 'user-1', userType: 'transporter' },
    body: {
      tripType: 'LOCAL',
      customerName: 'Acme Logistics',
      vehicleId: 'vehicle-1',
    },
  };
  const res = createMockRes();

  await controller.createTrip(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 201);
  assert.equal(savedTrips[0].queueSequence, 2);
  assert.equal(res.body.data.isQueued, true);
});

test('createTrip accepts optional container numbers in assignments', async () => {
  const controller = createTripController({
    '../models/Driver': {
      findById: async (id) => ({
        _id: id,
        transporterId: 'transporter-1',
        status: 'active',
      }),
    },
    '../services/transporterCustomer.service': {
      upsertCustomerLastUsed: async () => null,
    },
    '../services/tripQueue.service': {
      assignTripQueueMetadata: async (trip) => trip,
      getTripQueueInfo: async () => ({ queuePosition: 1, isQueued: false, blockingTripId: null }),
    },
    './tripStatus.controller': {
      tryAutoStartTrip: async () => null,
    },
  });

  const req = {
    user: { id: 'user-1', userType: 'transporter' },
    body: {
      tripType: 'LOCAL',
      customerName: 'Acme Logistics',
      assignments: [{ vehicleId: 'vehicle-1', driverId: 'driver-1' }],
    },
  };
  const res = createMockRes();

  await controller.createTrip(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 201);
});

test('validateContainerNumber requires 4 letters and 7 digits', () => {
  const { validateContainerNumber, normalizeContainerNumber } = require('../src/utils/validation');

  assert.equal(validateContainerNumber(normalizeContainerNumber('abcd1234567')), true);
  assert.equal(validateContainerNumber(normalizeContainerNumber('abcd123456')), false);
});

test('createTrip rejects duplicate vehicles or drivers within the same trip', async () => {
  const controller = createTripController({
    '../models/Driver': {
      findById: async (id) => ({
        _id: id,
        transporterId: 'transporter-1',
        status: 'active',
      }),
    },
    '../models/Vehicle': {
      findById: async (id) => ({
        _id: id,
        transporterId: 'transporter-1',
        ownerType: 'OWN',
        status: 'active',
      }),
    },
  });

  const req = {
    user: { id: 'user-1', userType: 'transporter' },
    body: {
      tripType: 'LOCAL',
      customerName: 'Acme Logistics',
      assignments: [
        { containerNumber: 'CONT-1', vehicleId: 'vehicle-1', driverId: 'driver-1' },
        { containerNumber: 'CONT-2', vehicleId: 'vehicle-1', driverId: 'driver-2' },
      ],
    },
  };
  const res = createMockRes();

  await controller.createTrip(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /vehicleId is already used/i);

  const duplicateDriverReq = {
    user: { id: 'user-1', userType: 'transporter' },
    body: {
      tripType: 'LOCAL',
      customerName: 'Acme Logistics',
      assignments: [
        { containerNumber: 'CONT-1', vehicleId: 'vehicle-1', driverId: 'driver-1' },
        { containerNumber: 'CONT-2', vehicleId: 'vehicle-2', driverId: 'driver-1' },
      ],
    },
  };
  const duplicateDriverRes = createMockRes();

  await controller.createTrip(duplicateDriverReq, duplicateDriverRes, (error) => {
    throw error;
  });

  assert.equal(duplicateDriverRes.statusCode, 400);
  assert.match(duplicateDriverRes.body.message, /driverId is already used/i);
});
