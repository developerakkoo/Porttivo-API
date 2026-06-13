const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

class TripDraftMock {
  constructor(payload) {
    Object.assign(this, payload);
    this._id = this._id || 'draft-1';
    this.tripId = this.tripId || 'TRIP-DRAFT-1';
    this.status = this.status || 'DRAFT';
  }

  async save() {
    return this;
  }

  toObject() {
    return { ...this };
  }
}

TripDraftMock.find = async () => [];
TripDraftMock.findOne = async () => null;
TripDraftMock.findOneAndDelete = async () => null;

const createTripController = (overrides = {}) =>
  loadWithMocks(path.resolve(__dirname, '..', 'src', 'controllers', 'trip.controller.js'), {
    '../models/Trip': overrides.Trip || TripDraftMock,
    '../models/Vehicle': {},
    '../models/Driver': {},
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
      checkVehicleHasActiveTrip: async () => false,
      buildResourceTripQuery: () => ({}),
      normalizeIndianVehicleRegistration: (value) => value,
      isValidIndianVehicleRegistration: () => true,
    },
    '../utils/tripResourceState': {
      markTripResourcesBusy: async () => {},
      releaseTripResources: async () => {},
      syncTripResourceBusyState: async () => {},
    },
    '../services/transporterCustomer.service': {
      upsertCustomerLastUsed: async () => null,
    },
    '../services/tripQueue.service': {
      assignTripQueueMetadata: async (trip) => trip,
      getTripQueueInfo: async () => ({ queuePosition: null, isQueued: false, blockingTripId: null }),
    },
    './tripStatus.controller': {
      tryAutoStartTrip: async () => null,
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
      getMarketplaceTripMetaForViewerId: () => null,
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
    ...overrides,
  });

test('saveTripDraft creates a draft trip', async () => {
  const saved = [];
  class DraftTrip extends TripDraftMock {
    constructor(payload) {
      super(payload);
      saved.push(this);
    }
  }

  const controller = createTripController({ '../models/Trip': DraftTrip });
  const req = {
    user: { id: 'user-1', userType: 'transporter' },
    body: {
      tripType: 'LOCAL',
      customerName: 'Acme Logistics',
      reference: 'ref-1',
    },
  };
  const res = createMockRes();

  await controller.saveTripDraft(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 201);
  assert.equal(saved[0].status, 'DRAFT');
  assert.equal(saved[0].customerName, 'ACME LOGISTICS');
});

test('listTripDrafts returns draft trips only', async () => {
  const controller = createTripController({
    '../models/Trip': {
      find: (query) => {
        assert.equal(query.status, 'DRAFT');
        assert.equal(query.transporterId, 'transporter-1');
        return {
          sort: () => ({
            limit: () => [{ _id: 'draft-1', status: 'DRAFT', tripId: 'TRIP-DRAFT-1' }],
          }),
        };
      },
    },
  });

  const req = { user: { id: 'user-1', userType: 'transporter' } };
  const res = createMockRes();

  await controller.listTripDrafts(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.length, 1);
  assert.equal(res.body.data[0].status, 'DRAFT');
});
