const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const loadMarketplaceCache = (cacheOverrides = {}) =>
  loadWithMocks(path.resolve(process.cwd(), 'src/utils/marketplaceCache.js'), {
    './cache': {
      getCache: cacheOverrides.getCache || (async () => null),
      setCache: cacheOverrides.setCache || (async () => true),
      deleteCachePattern:
        cacheOverrides.deleteCachePattern || (async () => true)
    },
    './logger': { info: () => {} }
  })

const loadSearchController = marketplaceCache => {
  let findCalls = 0
  const query = {
    sort() { return this },
    skip() { return this },
    limit() { return this },
    populate() { return this },
    lean: async () => {
      findCalls += 1
      return []
    }
  }
  const controller = loadWithMocks(
    path.resolve(process.cwd(), 'src/controllers/vehiclePost.controller.js'),
    {
      '../models/Vehicle': {},
      '../models/VehicleRouteAvailability': {
        find: () => {
          findCalls += 1
          return query
        }
      },
      '../models/VehicleRouteAssignment': {},
      '../models/VehicleBooking': {},
      '../models/VehiclePostActivity': {
        VehiclePostActivity: {},
        POST_ACTIVITY_ACTIONS: {}
      },
      '../middleware/permission.middleware': { getTransporterId: () => null },
      '../services/socket.service': {},
      '../utils/location': {},
      '../utils/vehiclePostPrice.util': {},
      '../utils/vehiclePostRoutes.util': {},
      '../services/vehicleTypeCatalog.service': {},
      '../utils/vehiclePostDestinationQuotas': {},
      '../utils/liveVehicleAssignment': { liveAssignmentFilter: value => value },
      '../utils/marketplaceAvailability.util': {
        getConfirmedAssignmentIds: async () => new Set(),
        filterBookableAssignments: rows => rows,
        hasBookableInventory: () => true,
        countPostsWithBookableInventory: async () => 0
      },
      '../utils/marketplaceCache': marketplaceCache
    }
  )
  return { controller, getFindCalls: () => findCalls }
}

const loadPostDetailController = marketplaceCache => {
  let findByIdCalls = 0
  const post = {
    _id: 'post-1',
    transporterId: { _id: 'owner-1', name: 'Owner', company: 'Fleet' },
    vehicleId: null,
    vehicleType: 'Truck',
    origin: { formattedAddress: 'Pune' },
    destination: null,
    destinations: [],
    routes: [],
    quantity: 1,
    slotsLeft: 1,
    status: 'paused',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z')
  }
  const postQuery = {
    populate() { return this },
    lean: async () => post
  }
  const assignmentsQuery = {
    populate() { return this },
    lean: async () => []
  }
  const controller = loadWithMocks(
    path.resolve(process.cwd(), 'src/controllers/vehiclePost.controller.js'),
    {
      '../models/Vehicle': {},
      '../models/VehicleRouteAvailability': {
        findById: () => {
          findByIdCalls += 1
          return postQuery
        }
      },
      '../models/VehicleRouteAssignment': { find: () => assignmentsQuery },
      '../models/VehicleBooking': {},
      '../models/VehiclePostActivity': {},
      '../middleware/permission.middleware': {
        getTransporterId: user => user.id === 'owner-user' ? 'owner-1' : 'viewer-2'
      },
      '../services/socket.service': {},
      '../utils/location': {},
      '../utils/vehiclePostPrice.util': {},
      '../utils/vehiclePostRoutes.util': { routesApiFields: () => ({}) },
      '../services/vehicleTypeCatalog.service': {},
      '../utils/vehiclePostDestinationQuotas': {
        canonicalDestinationStopCount: () => 1,
        getDestinationQuantitiesResolved: () => [1]
      },
      '../utils/liveVehicleAssignment': { liveAssignmentFilter: value => value },
      '../utils/marketplaceAvailability.util': {
        getConfirmedAssignmentIds: async () => new Set(),
        filterBookableAssignments: rows => rows,
        hasBookableInventory: () => true
      },
      '../utils/marketplaceCache': marketplaceCache
    }
  )
  return { controller, getFindByIdCalls: () => findByIdCalls }
}

const loadPostMutationController = ({ operation, post, populatedPost }) => {
  const invalidatedPostIds = []
  const cache = {
    MARKETPLACE_SEARCH_TTL: 25,
    MARKETPLACE_POST_DETAIL_TTL: 30,
    vehiclePostSearchKey: () => 'search-key',
    vehiclePostDetailKey: () => 'detail-key',
    getMarketplaceCache: async () => null,
    setMarketplaceCache: async () => true,
    invalidateMarketplaceCaches: async postId => {
      invalidatedPostIds.push(String(postId))
      return true
    }
  }
  const query = doc => ({
    populate() { return this },
    lean: async () => doc
  })
  const availability = {
    create: async () => ({ _id: 'post-1' }),
    findOne: () => ({ select: () => ({ lean: async () => null }) }),
    findById: () => query(populatedPost)
  }
  let findByIdCalls = 0
  availability.findById = () => {
    findByIdCalls += 1
    return operation !== 'create' && findByIdCalls === 1
      ? post
      : query(populatedPost)
  }
  const assignmentModel = {
    countDocuments: async () => operation === 'update' || operation === 'resume' ? 1 : 0,
    find: () => ({ lean: async () => [] }),
    insertMany: async () => [{ _id: 'assignment-1' }]
  }
  const mongoose = {
    startSession: async () => ({
      startTransaction() {},
      commitTransaction: async () => {},
      endSession() {}
    })
  }
  const controller = loadWithMocks(
    path.resolve(process.cwd(), 'src/controllers/vehiclePost.controller.js'),
    {
      mongoose,
      '../models/Vehicle': {
        find: async () => [{
          _id: 'vehicle-1',
          transporterId: 'owner-1',
          status: 'active',
          vehicleType: 'Truck',
          vehicleNumber: 'MH12AB1234'
        }]
      },
      '../models/VehicleRouteAvailability': availability,
      '../models/VehicleRouteAssignment': assignmentModel,
      '../models/VehicleBooking': { countDocuments: async () => 0 },
      '../models/VehiclePostActivity': {
        VehiclePostActivity: { logAction: async () => {} },
        POST_ACTIVITY_ACTIONS: new Proxy({}, { get: (_, key) => key })
      },
      '../middleware/permission.middleware': { getTransporterId: () => 'owner-1' },
      '../services/socket.service': { getIO: () => ({ emit() {} }) },
      '../utils/location': {
        normalizeLocationInput: value => value || { formattedAddress: 'Pune' },
        validateLocationInput: () => null
      },
      '../utils/vehiclePostPrice.util': {
        parseOptionalPricePerVehicle: () => ({ ok: true, value: null })
      },
      '../utils/vehiclePostRoutes.util': {
        parseRoutesInput: () => ({ ok: true, routes: [] }),
        minListedRate: () => null,
        routesApiFields: () => ({})
      },
      '../services/vehicleTypeCatalog.service': {
        assertVehicleTypeAllowed: async vehicleType => ({ ok: true, name: vehicleType })
      },
      '../utils/vehiclePostDestinationQuotas': {
        canonicalDestinationStopCount: () => 1,
        getDestinationQuantitiesResolved: () => [2],
        parseDestinationQuantitiesInput: () => ({ ok: true, quantities: [2] }),
        countAssignmentsPerStop: () => [0],
        effectiveServedStopIndexes: () => [0],
        validateServedStopIndexes: () => null,
        normalizeServedStopIndexesInput: () => [0],
        stopLabelForIndex: () => 'Pune'
      },
      '../utils/liveVehicleAssignment': { liveAssignmentFilter: value => value },
      '../utils/marketplaceAvailability.util': {
        getConfirmedAssignmentIds: async () => new Set(),
        filterBookableAssignments: rows => rows,
        hasBookableInventory: () => true,
        countPostsWithBookableInventory: async () => 0
      },
      '../utils/marketplaceCache': cache
    }
  )
  return { controller, invalidatedPostIds }
}

const loadBookingMutationController = operation => {
  const invalidatedPostIds = []
  const booking = {
    _id: 'booking-1',
    postId: 'post-1',
    assignmentId: 'assignment-1',
    buyerId: 'buyer-1',
    sellerId: 'seller-1',
    vehicleId: 'vehicle-1',
    status: operation === 'confirm' ? 'REQUESTED' : 'REQUESTED',
    estimatedPrice: 100,
    tripId: null,
    save: async () => {}
  }
  const populatedBooking = { ...booking }
  let findByIdCalls = 0
  const bookingQuery = {
    populate() { return this },
    lean: async () => populatedBooking
  }
  const session = {
    startTransaction() {},
    commitTransaction: async () => {},
    abortTransaction: async () => {},
    endSession() {}
  }
  const updatedPost = {
    _id: 'post-1',
    slotsLeft: 1,
    status: 'active',
    save: async () => {}
  }
  const cache = {
    invalidateMarketplaceCaches: async postId => {
      invalidatedPostIds.push(String(postId))
      return true
    },
    invalidateMarketplaceBookingCaches: async () => true
  }
  const controller = loadWithMocks(
    path.resolve(process.cwd(), 'src/controllers/vehicleBooking.controller.js'),
    {
      mongoose: { startSession: async () => session },
      '../models/Notification': { create: async () => ({}) },
      '../models/VehicleBooking': {
        findById: () => {
          findByIdCalls += 1
          if (findByIdCalls === 1) return booking
          if (operation === 'confirm' && findByIdCalls === 2) {
            return { session: async () => booking }
          }
          return bookingQuery
        },
        findByIdAndUpdate: async () => null,
        countDocuments: async () => 0
      },
      '../models/VehicleRouteAvailability': {
        findOneAndUpdate: async () => updatedPost,
        findById: () => ({ session: async () => updatedPost })
      },
      '../models/VehicleRouteAssignment': {
        findByIdAndUpdate: async () => ({}),
        findOne: () => ({ session: async () => ({ _id: 'assignment-1' }) }),
        countDocuments: async () => 1
      },
      '../models/TransporterMessage': { create: async () => ({}) },
      '../models/Vehicle': {},
      '../models/Transporter': {},
      '../services/bookingToTrip.service': {
        createTripFromBooking: async () => ({ _id: 'trip-1' })
      },
      '../services/socket.service': {
        getIO: () => ({ to: () => ({ emit() {} }), emit() {} })
      },
      '../models/VehicleBookingAudit': {
        VehicleBookingAudit: { logAction: async () => {} },
        BOOKING_AUDIT_ACTIONS: new Proxy({}, { get: (_, key) => key })
      },
      '../models/VehiclePostActivity': {
        VehiclePostActivity: { logAction: async () => {} },
        POST_ACTIVITY_ACTIONS: new Proxy({}, { get: (_, key) => key })
      },
      '../utils/transporterActor': { getTransporterActorId: () => operation === 'confirm' ? 'seller-1' : 'buyer-1' },
      '../utils/marketplaceChatPayload': { buildChatMessageSocketPayload: () => ({}) },
      '../utils/marketplaceNotification': { buildMarketplaceMessageNotificationFields: () => ({}) },
      '../utils/liveVehicleAssignment': { liveAssignmentFilter: value => value },
      '../utils/vehiclePostRoutes.util': { resolveRouteDirectionRate: () => null },
      '../utils/marketplaceCache': cache
    }
  )
  return { controller, invalidatedPostIds }
}

const loadBookingReadController = marketplaceCache => {
  let bookingFindCalls = 0
  let bookingCountCalls = 0
  let messageAggregateCalls = 0
  const query = {
    populate() { return this },
    sort() { return this },
    lean: async () => []
  }
  const controller = loadWithMocks(
    path.resolve(process.cwd(), 'src/controllers/vehicleBooking.controller.js'),
    {
      mongoose: { Types: { ObjectId: class { constructor(value) { return value } } } },
      '../models/Notification': {},
      '../models/VehicleBooking': {
        find: () => {
          bookingFindCalls += 1
          return query
        },
        countDocuments: async () => {
          bookingCountCalls += 1
          return 0
        }
      },
      '../models/VehicleRouteAvailability': {},
      '../models/VehicleRouteAssignment': {},
      '../models/TransporterMessage': {
        aggregate: async () => {
          messageAggregateCalls += 1
          return []
        }
      },
      '../models/Vehicle': {},
      '../models/Transporter': {},
      '../services/bookingToTrip.service': {},
      '../services/socket.service': {},
      '../models/VehicleBookingAudit': {},
      '../models/VehiclePostActivity': {},
      '../utils/transporterActor': { getTransporterActorId: user => user.id },
      '../utils/marketplaceChatPayload': {},
      '../utils/marketplaceNotification': {},
      '../utils/liveVehicleAssignment': {},
      '../utils/vehiclePostRoutes.util': {},
      '../utils/marketplaceCache': marketplaceCache
    }
  )
  return {
    controller,
    getBookingFindCalls: () => bookingFindCalls,
    getBookingCountCalls: () => bookingCountCalls,
    getMessageAggregateCalls: () => messageAggregateCalls
  }
}

const marketplaceCacheTests = [
  {
    name: 'Marketplace search keys normalize equivalent queries and isolate filters and pagination',
    run() {
      const cache = loadMarketplaceCache()
      const base = {
        origin: '  Pune   Central ',
        destination: 'Mumbai',
        date: '2026-09-28',
        vehicleType: 'Truck',
        page: '1',
        limit: '20'
      }
      const normalized = { ...base, origin: 'pune central', page: 1, limit: 20 }

      assert.equal(cache.vehiclePostSearchKey(base), cache.vehiclePostSearchKey(normalized))
      for (const changed of [
        { origin: 'Nashik' },
        { destination: 'Surat' },
        { date: '2026-09-29' },
        { vehicleType: 'Container' },
        { page: '2' },
        { limit: '10' }
      ]) {
        assert.notEqual(
          cache.vehiclePostSearchKey(base),
          cache.vehiclePostSearchKey({ ...base, ...changed })
        )
      }
    }
  },
  {
    name: 'Marketplace post detail cache keys isolate owner and non-owner scopes',
    run() {
      const cache = loadMarketplaceCache()
      assert.notEqual(
        cache.vehiclePostDetailKey('post-1', 'public'),
        cache.vehiclePostDetailKey('post-1', 'transporter:owner-1')
      )
      assert.notEqual(
        cache.vehiclePostDetailKey('post-1', 'transporter:owner-1'),
        cache.vehiclePostDetailKey('post-1', 'transporter:viewer-2')
      )
      assert.notEqual(
        cache.vehiclePostDetailKey('post-1', 'public'),
        cache.vehiclePostDetailKey('post-2', 'public')
      )
    }
  },
  {
    name: 'Marketplace post detail cache cannot serve an owner-only response to a non-owner',
    async run() {
      const values = new Map()
      const cache = loadMarketplaceCache({
        getCache: async key => values.get(key) || null,
        setCache: async (key, value) => {
          values.set(key, value)
          return true
        }
      })
      const { controller, getFindByIdCalls } = loadPostDetailController(cache)
      const ownerResponse = createMockRes()
      const nonOwnerResponse = createMockRes()

      await controller.getById(
        { params: { id: 'post-1' }, user: { id: 'owner-user' } },
        ownerResponse,
        error => { throw error }
      )
      await controller.getById(
        { params: { id: 'post-1' }, user: { id: 'viewer-user' } },
        nonOwnerResponse,
        error => { throw error }
      )

      assert.equal(ownerResponse.statusCode, 200)
      assert.equal(nonOwnerResponse.statusCode, 404)
      assert.equal(getFindByIdCalls(), 2)
    }
  },
  {
    name: 'Marketplace search caches a miss and skips MongoDB on a hit',
    async run() {
      const values = new Map()
      const ttls = new Map()
      const cache = loadMarketplaceCache({
        getCache: async key => values.get(key) || null,
        setCache: async (key, value, ttl) => {
          values.set(key, value)
          ttls.set(key, ttl)
          return true
        }
      })
      const { controller, getFindCalls } = loadSearchController(cache)
      const req = { query: { origin: 'Pune', page: '1', limit: '20' } }
      const first = createMockRes()
      const second = createMockRes()

      await controller.searchAvailability(req, first, error => { throw error })
      await controller.searchAvailability(req, second, error => { throw error })

      assert.equal(first.statusCode, 200)
      assert.deepEqual(second.body, first.body)
      assert.equal(getFindCalls(), 2)
      assert.equal([...ttls.values()][0], cache.MARKETPLACE_SEARCH_TTL)
      assert.equal(cache.MARKETPLACE_SEARCH_TTL, 25)
    }
  },
  {
    name: 'Marketplace search falls back to MongoDB when Redis operations fail',
    async run() {
      const cache = loadMarketplaceCache({
        getCache: async () => { throw new Error('redis unavailable') },
        setCache: async () => { throw new Error('redis unavailable') }
      })
      const { controller, getFindCalls } = loadSearchController(cache)
      const res = createMockRes()

      await controller.searchAvailability(
        { query: { origin: 'Pune' } },
        res,
        error => { throw error }
      )

      assert.equal(res.statusCode, 200)
      assert.equal(getFindCalls(), 2)
    }
  },
  {
    name: 'Marketplace my-bookings and booking stats cache per transporter and bypass MongoDB on hits',
    async run() {
      const values = new Map()
      const ttls = new Map()
      const cache = loadMarketplaceCache({
        getCache: async key => values.get(key) || null,
        setCache: async (key, value, ttl) => {
          values.set(key, value)
          ttls.set(key, ttl)
          return true
        }
      })
      const req = { user: { id: 'transporter-1' }, query: {} }
      const list = loadBookingReadController(cache)

      await list.controller.getMyBookings(req, createMockRes(), error => { throw error })
      await list.controller.getMyBookings(req, createMockRes(), error => { throw error })
      assert.equal(list.getBookingFindCalls(), 1)
      assert.equal(list.getMessageAggregateCalls(), 1)
      assert.equal([...ttls.values()][0], cache.MARKETPLACE_BOOKING_LIST_TTL)

      const stats = loadBookingReadController(cache)
      await stats.controller.getBookingStats(req, createMockRes(), error => { throw error })
      await stats.controller.getBookingStats(req, createMockRes(), error => { throw error })
      assert.equal(stats.getBookingCountCalls(), 5)
      assert.equal([...ttls.values()][1], cache.MARKETPLACE_BOOKING_STATS_TTL)
      assert.notEqual(
        cache.bookingListKey('transporter-1', {}),
        cache.bookingListKey('transporter-2', {})
      )
      assert.notEqual(
        cache.paymentListKey('transporter-1', { page: 1 }),
        cache.paymentListKey('transporter-2', { page: 1 })
      )
    }
  },
  {
    name: 'Marketplace invalidation targets search, post, booking, and payment key patterns',
    async run() {
      const patterns = []
      const cache = loadMarketplaceCache({
        deleteCachePattern: async pattern => {
          patterns.push(pattern)
          return true
        }
      })

      await cache.invalidateMarketplaceCaches('post-1')
      await cache.invalidateMarketplaceBookingCaches('buyer-1', 'seller-1')
      await cache.invalidateMarketplaceBookingCaches({ _id: 'buyer-2' })
      await cache.invalidateMarketplacePaymentCaches('payer-1', 'beneficiary-1')
      await cache.invalidateMarketplacePaymentCaches({ id: 'payer-2' })

      assert.ok(patterns.includes('marketplace:posts:search:*'))
      assert.ok(patterns.includes('marketplace:post:post-1:*'))
      assert.ok(patterns.includes('marketplace:bookings:user:buyer-1:*'))
      assert.ok(patterns.includes('marketplace:bookings:user:seller-1:*'))
      assert.ok(patterns.includes('marketplace:bookings:user:buyer-2:*'))
      assert.ok(patterns.includes('marketplace:payments:user:payer-1:*'))
      assert.ok(patterns.includes('marketplace:payments:user:beneficiary-1:*'))
      assert.ok(patterns.includes('marketplace:payments:user:payer-2:*'))
    }
  },
  {
    name: 'Create, update, pause, resume, and add-vehicle handlers invalidate Marketplace post caches',
    async run() {
      const basePost = {
        _id: 'post-1',
        transporterId: 'owner-1',
        vehicleType: 'Truck',
        quantity: 2,
        slotsLeft: 2,
        status: 'active',
        destination: null,
        destinations: [],
        routes: [],
        save: async () => {}
      }
      const populatedPost = {
        ...basePost,
        transporterId: { _id: 'owner-1', name: 'Owner', company: 'Fleet' },
        vehicleId: null
      }
      const cases = [
        {
          operation: 'create',
          invoke: controller => controller.createAvailability({
            user: {},
            body: {
              vehicleType: 'Truck',
              origin: { formattedAddress: 'Pune' },
              availableFrom: '2026-09-28',
              availableTo: '2026-09-29',
              quantity: 2
            }
          }, createMockRes(), error => { throw error })
        },
        {
          operation: 'update',
          invoke: controller => controller.updateAvailability({
            user: {}, params: { id: 'post-1' }, body: { note: 'updated' }
          }, createMockRes(), error => { throw error })
        },
        {
          operation: 'pause',
          invoke: controller => controller.pausePost({
            user: {}, params: { id: 'post-1' }
          }, createMockRes(), error => { throw error })
        },
        {
          operation: 'resume',
          invoke: controller => controller.resumePost({
            user: {}, params: { id: 'post-1' }
          }, createMockRes(), error => { throw error })
        },
        {
          operation: 'add',
          invoke: controller => controller.addVehicleToPost({
            user: {},
            params: { id: 'post-1' },
            body: { vehicleId: 'vehicle-1' }
          }, createMockRes(), error => { throw error })
        }
      ]

      for (const testCase of cases) {
        const { controller, invalidatedPostIds } = loadPostMutationController({
          operation: testCase.operation,
          post: { ...basePost, status: testCase.operation === 'resume' ? 'paused' : 'active' },
          populatedPost
        })
        await testCase.invoke(controller)
        assert.deepEqual(invalidatedPostIds, ['post-1'], testCase.operation)
      }
    }
  },
  {
    name: 'Booking confirmation and cancellation release invalidate Marketplace inventory caches',
    async run() {
      const confirmation = loadBookingMutationController('confirm')
      const confirmationRes = createMockRes()
      await confirmation.controller.acceptBooking(
        { params: { id: 'booking-1' }, user: {}, body: {} },
        confirmationRes,
        error => { throw error }
      )
      assert.equal(confirmationRes.statusCode, 200)
      assert.deepEqual(confirmation.invalidatedPostIds, ['post-1'])

      const cancellation = loadBookingMutationController('cancel')
      const cancellationRes = createMockRes()
      await cancellation.controller.cancelBooking(
        { params: { id: 'booking-1' }, user: {}, body: {} },
        cancellationRes,
        error => { throw error }
      )
      assert.equal(cancellationRes.statusCode, 200)
      assert.deepEqual(cancellation.invalidatedPostIds, ['post-1'])
    }
  }
]

module.exports = marketplaceCacheTests

if (require.main === module) {
  ;(async () => {
    let passed = 0
    for (const test of marketplaceCacheTests) {
      try {
        await test.run()
        console.log(`PASS ${test.name}`)
        passed++
      } catch (error) {
        console.error(`FAIL ${test.name}`)
        console.error(error)
        process.exitCode = 1
      }
    }
    console.log(`\n${passed}/${marketplaceCacheTests.length} tests passed`)
  })()
}