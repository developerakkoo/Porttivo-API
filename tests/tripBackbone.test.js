const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

test('startTrip rejects planned trip without assigned driver', async () => {
  const controller = loadWithMocks('../src/controllers/tripStatus.controller.js', {
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
    '../utils/vehicleValidation': {
      checkVehicleHasActiveTrip: async () => false,
    },
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
    '../services/tripQueue.service': {
      activateNextTrip: async () => null,
    },
    '../services/wati.service': {
      sendTripCompletedTemplate: async () => {},
    },
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
});

test('completeTrip moves active trip to POD_PENDING and auto-activates next trip', async () => {
  const emits = {
    podPending: 0,
    completed: 0,
    autoActivated: 0,
  };

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

  const controller = loadWithMocks('../src/controllers/tripStatus.controller.js', {
    '../models/Trip': {
      findById: async () => trip,
    },
    '../models/Vehicle': {},
    '../models/Driver': {},
    '../utils/vehicleValidation': {
      checkVehicleHasActiveTrip: async () => false,
    },
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
    '../services/tripQueue.service': {
      activateNextTrip: async () => nextTrip,
    },
    '../services/wati.service': {
      sendTripCompletedTemplate: async () => {},
    },
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
});
