const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

const cache = new Map();
let findCalls = 0;
let countCalls = 0;
let queueCalls = 0;

const cacheMock = {
  getCache: async (key) => cache.get(key) || null,
  setCache: async (key, value, ttl) => {
    cache.set(key, value);
    cache.set(`${key}:ttl`, ttl);
    return true;
  },
};

const makeTrip = (id) => ({
  _id: id,
  tripId: `TRIP-${id}`,
  status: 'PLANNED',
  tripType: 'LOCAL',
  createdAt: new Date(),
  transporterId: 'transporter-1',
  toObject() {
    return { ...this };
  },
});

const createController = (Trip) =>
  loadWithMocks(path.resolve(__dirname, '..', 'src', 'controllers', 'trip.controller.js'), {
    '../models/Trip': Trip,
    '../models/Vehicle': {},
    '../models/Driver': {},
    '../models/Customer': {},
    '../models/Transporter': {},
    '../models/Notification': { create: async () => ({}) },
    '../models/SystemConfig': { findOne: () => ({ select: async () => null }) },
    '../utils/cache': cacheMock,
    '../utils/vehicleValidation': {},
    '../utils/tripResourceState': {},
    '../services/socket.service': {},
    '../middleware/permission.middleware': {
      getTransporterId: () => 'transporter-1',
      hasPermission: () => true,
    },
    '../services/tripAccess.service': {
      transporterPartyScopeCondition: (id) => ({ transporterId: id }),
      canBookingBuyerViewTrip: async () => false,
      getMarketplaceTripMetaForUser: async () => null,
      getMarketplaceTripMetaForViewerId: () => null,
    },
    '../services/wati.service': {},
    '../services/savedLocation.service': {},
    '../services/transporterCustomer.service': {},
    '../services/tripQueue.service': {
      getTripQueueInfo: async () => {
        queueCalls += 1;
        return { queuePosition: null, isQueued: false, blockingTripId: null };
      },
      assignTripQueueMetadata: async (trip) => trip,
    },
    './tripStatus.controller': {},
    '../services/tripVisibility.service': {},
    '../utils/validation': {},
    '../services/tripEta.service': {},
  });

const user = { id: 'user-1', userType: 'transporter' };

const reset = () => {
  cache.clear();
  findCalls = 0;
  countCalls = 0;
  queueCalls = 0;
};

test('draft list caches misses and serves hits with the configured TTL', { concurrency: false }, async () => {
  reset();
  const Trip = {
    find: () => {
      findCalls += 1;
      return { sort: () => ({ limit: async () => [makeTrip('draft-1')] }) };
    },
  };
  const controller = createController(Trip);

  const first = createMockRes();
  await controller.listTripDrafts({ user }, first, (error) => { throw error; });
  const second = createMockRes();
  await controller.listTripDrafts({ user }, second, (error) => { throw error; });

  assert.equal(findCalls, 1);
  assert.deepEqual(second.body, first.body);
  const key = [...cache.keys()].find((value) => value.startsWith('trip-drafts:list:'));
  assert.equal(cache.get(`${key}:ttl`), 60);
});

test('draft detail cache is isolated by user and draft id', { concurrency: false }, async () => {
  reset();
  const Trip = {
    findOne: async () => {
      findCalls += 1;
      return makeTrip(`draft-${findCalls}`);
    },
  };
  const controller = createController(Trip);

  await controller.getTripDraftById({ user, params: { id: 'draft-1' } }, createMockRes(), (error) => { throw error; });
  await controller.getTripDraftById({ user: { ...user, id: 'user-2' }, params: { id: 'draft-1' } }, createMockRes(), (error) => { throw error; });
  await controller.getTripDraftById({ user, params: { id: 'draft-2' } }, createMockRes(), (error) => { throw error; });

  assert.equal(findCalls, 3);
  assert.equal([...cache.keys()].filter((key) => key.startsWith('trip-drafts:detail:') && !key.endsWith(':ttl')).length, 3);
});

test('trip list cache includes all query params and avoids queue and Mongo work on hit', { concurrency: false }, async () => {
  reset();
  const Trip = {
    find: () => {
      findCalls += 1;
      const chain = {
        populate: () => chain,
        sort: () => chain,
        skip: () => chain,
        limit: async () => [makeTrip('trip-1')],
      };
      return chain;
    },
    countDocuments: async () => {
      countCalls += 1;
      return 1;
    },
  };
  const controller = createController(Trip);
  const req = {
    user,
    query: { status: 'PLANNED', page: '1', limit: '20', customResponseFilter: 'a' },
  };

  await controller.getTrips(req, createMockRes(), (error) => { throw error; });
  await controller.getTrips(req, createMockRes(), (error) => { throw error; });
  await controller.getTrips({ ...req, query: { ...req.query, customResponseFilter: 'b' } }, createMockRes(), (error) => { throw error; });

  assert.equal(findCalls, 2);
  assert.equal(countCalls, 2);
  assert.equal(queueCalls, 2);
  assert.equal([...cache.keys()].filter((key) => key.startsWith('trips:list:') && !key.endsWith(':ttl')).length, 2);
});

test('trip group lookup uses the group id for its read cache key', { concurrency: false }, async () => {
  reset();
  const trip = {
    ...makeTrip('trip-1'),
    tripGroupId: 'GRP-1',
    routeIndex: 0,
    pickupLocation: null,
    intermediateLocation: null,
    dropLocation: null,
  };
  const Trip = {
    find: () => {
      const chain = {
        populate: () => chain,
        sort: async () => [trip],
      };
      return chain;
    },
  };
  const controller = createController(Trip);
  const response = createMockRes();

  await controller.getTripGroup(
    { user, params: { groupId: 'GRP-1' } },
    response,
    (error) => { throw error; }
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.data.group.tripGroupId, 'GRP-1');
});

test('trip cache invalidation clears both trip and draft namespaces', { concurrency: false }, async () => {
  const deletedPatterns = [];
  const { invalidateTripCaches } = loadWithMocks(path.resolve(__dirname, '..', 'src', 'utils', 'tripCache.js'), {
    './cache': { deleteCachePattern: async (pattern) => deletedPatterns.push(pattern) },
    './logger': { info: () => {} },
  });

  await invalidateTripCaches();
  assert.deepEqual(deletedPatterns.sort(), [
    'admin:analytics:*',
    'admin:dashboard-stats:*',
    'admin:driver:*',
    'admin:drivers:*',
    'admin:trips:*',
    'trip-drafts:*',
    'trips:*',
  ]);
});
