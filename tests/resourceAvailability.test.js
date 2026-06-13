const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadWithMocks } = require('./helpers/loadWithMocks');

const validationPath = path.resolve(process.cwd(), 'src/utils/vehicleValidation.js');

const loadValidation = (overrides = {}) =>
  loadWithMocks(validationPath, {
    '../models/Vehicle': overrides.Vehicle || {},
    '../models/Driver': overrides.Driver || {},
    '../models/Trip': overrides.Trip || {},
    '../utils/tripState': {
      TRIP_STATUS: {
        ACCEPTED: 'ACCEPTED',
        PLANNED: 'PLANNED',
        ACTIVE: 'ACTIVE',
        PAUSED: 'PAUSED',
        POD_PENDING: 'POD_PENDING',
      },
    },
  });

test('checkVehicleHasAssignedTrip matches assignments.vehicleId', async () => {
  let capturedQuery = null;
  const validation = loadValidation({
    Trip: {
      findOne: async (query) => {
        capturedQuery = query;
        return { _id: 'trip-1' };
      },
    },
  });

  const result = await validation.checkVehicleHasAssignedTrip('vehicle-1');
  assert.equal(result, true);
  assert.equal(capturedQuery.$or.length, 2);
  assert.deepEqual(capturedQuery.$or[0], { vehicleId: 'vehicle-1' });
  assert.deepEqual(capturedQuery.$or[1], { 'assignments.vehicleId': 'vehicle-1' });
});

test('checkDriverHasAssignedTrip matches assignments.driverId', async () => {
  let capturedQuery = null;
  const validation = loadValidation({
    Trip: {
      findOne: async (query) => {
        capturedQuery = query;
        return null;
      },
    },
  });

  await validation.checkDriverHasAssignedTrip('driver-1', 'trip-exclude');
  assert.equal(capturedQuery._id.$ne, 'trip-exclude');
  assert.deepEqual(capturedQuery.$or[1], { 'assignments.driverId': 'driver-1' });
});

test('getDriverAvailabilityState marks busy driver unavailable', async () => {
  const validation = loadValidation({
    Driver: {
      findById: () => ({
        select: async () => ({ _id: 'driver-1', status: 'active', isBusy: false }),
      }),
    },
    Trip: {
      findOne: async () => ({ _id: 'trip-busy' }),
    },
  });

  const state = await validation.getDriverAvailabilityState('driver-1');
  assert.equal(state.isAvailable, false);
  assert.equal(state.isBusy, true);
});

test('getDriverAvailabilityState marks free active driver available', async () => {
  const validation = loadValidation({
    Driver: {
      findById: () => ({
        select: async () => ({ _id: 'driver-2', status: 'active', isBusy: false }),
      }),
    },
    Trip: {
      findOne: async () => null,
    },
  });

  const state = await validation.getDriverAvailabilityState('driver-2');
  assert.equal(state.isAvailable, true);
  assert.equal(state.isBusy, false);
});

test('getDriverAvailabilityState excludes inactive drivers', async () => {
  const validation = loadValidation({
    Driver: {
      findById: () => ({
        select: async () => ({ _id: 'driver-3', status: 'inactive', isBusy: false }),
      }),
    },
    Trip: {
      findOne: async () => null,
    },
  });

  const state = await validation.getDriverAvailabilityState('driver-3');
  assert.equal(state.isAvailable, false);
});

test('LOCAL is accepted as a valid trip type constant', async () => {
  const tripState = require('../src/utils/tripState');
  assert.ok(tripState.TRIP_TYPE_VALUES.includes('LOCAL'));
});
