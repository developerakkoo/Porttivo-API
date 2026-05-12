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

const createTripController = (overrides = {}) =>
  loadWithMocks(path.resolve(__dirname, '..', 'src', 'controllers', 'trip.controller.js'), {
    '../models/Trip': TripMock,
    '../models/Vehicle': {
      findById: async () => ({
        _id: 'vehicle-1',
        transporterId: 'transporter-1',
        ownerType: 'OWN',
        status: 'active',
      }),
    },
    '../models/Driver': {
      findById: async () => null,
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
      checkVehicleHasActiveTrip: async () => false,
      normalizeIndianVehicleRegistration: (value) => value,
      isValidIndianVehicleRegistration: () => true,
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

test('createTrip accepts LOCAL trips and blocks vehicles with active trips', async () => {
  const controller = createTripController({
    '../utils/vehicleValidation': {
      checkVehicleHasActiveTrip: async () => true,
      normalizeIndianVehicleRegistration: (value) => value,
      isValidIndianVehicleRegistration: () => true,
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

  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /active trip/i);
});
