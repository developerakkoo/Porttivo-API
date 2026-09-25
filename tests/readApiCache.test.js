const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const tests = []
const test = (name, run) => tests.push({ name, run })

const loadCacheHelper = (file, cache) => loadWithMocks(
  path.resolve(process.cwd(), `src/utils/${file}.js`),
  { './cache': cache }
)

test('notification cache uses hashed user keys, 30 second TTL, HIT/MISS, and invalidation', async () => {
  const calls = { get: [], set: [], patterns: [] }
  const cache = {
    getCache: async key => {
      calls.get.push(key)
      return null
    },
    setCache: async (...args) => {
      calls.set.push(args)
      return true
    },
    deleteCachePattern: async pattern => {
      calls.patterns.push(pattern)
      return true
    }
  }
  const helper = loadCacheHelper('notificationCache', cache)
  const key = helper.notificationKey('user-1', { page: 1, limit: 20 })

  assert.match(key, /^porttivo:notifications:user-1:[a-f0-9]{64}$/)
  assert.equal(await helper.getNotificationCache(key), null)
  assert.equal(await helper.setNotificationCache(key, { success: true }), true)
  assert.deepEqual(calls.set[0], [key, { success: true }, 30])
  await helper.invalidateNotificationCache('user-1')
  assert.deepEqual(calls.patterns, ['porttivo:notifications:user-1:*'])
})

test('unread message cache uses the requested key and 10 second TTL', async () => {
  const calls = { get: [], set: [], delete: [] }
  const cache = {
    getCache: async key => {
      calls.get.push(key)
      return { success: true }
    },
    setCache: async (...args) => {
      calls.set.push(args)
      return true
    },
    deleteCache: async key => {
      calls.delete.push(key)
      return true
    }
  }
  const helper = loadCacheHelper('unreadMessageCache', cache)
  const key = helper.unreadMessageKey('user-2')

  assert.equal(key, 'porttivo:messages:unread:user-2')
  assert.deepEqual(await helper.getUnreadMessageCache(key), { success: true })
  await helper.setUnreadMessageCache(key, { success: true })
  assert.deepEqual(calls.set[0], [key, { success: true }, 10])
  await helper.invalidateUnreadMessageCache('user-2')
  assert.deepEqual(calls.delete, [key])
})

test('trip read cache uses requested TTLs and invalidates every affected key family', async () => {
  const calls = { get: [], set: [], delete: [], patterns: [] }
  const cache = {
    getCache: async key => {
      calls.get.push(key)
      return null
    },
    setCache: async (...args) => {
      calls.set.push(args)
      return true
    },
    deleteCache: async key => {
      calls.delete.push(key)
      return true
    },
    deleteCachePattern: async pattern => {
      calls.patterns.push(pattern)
      return true
    }
  }
  const helper = loadCacheHelper('tripReadCache', cache)
  const tripId = 'trip-3'
  const timelineKey = helper.timelineKey(tripId, { limit: 50, since: 'today' })
  const locationKey = helper.completedLocationKey(tripId, { limit: 50, since: null })

  assert.equal(helper.tripKey(tripId), 'porttivo:trip:trip-3')
  assert.equal(helper.milestoneKey(tripId), 'porttivo:trip:trip-3:milestone')
  assert.match(timelineKey, /^porttivo:trip:trip-3:timeline:[a-f0-9]{64}$/)
  assert.match(locationKey, /^porttivo:trip:trip-3:location-trail:completed:[a-f0-9]{64}$/)
  await helper.setTripReadCache(helper.tripKey(tripId), { success: true }, helper.TRIP_TTL)
  await helper.setTripReadCache(helper.milestoneKey(tripId), { success: true }, helper.MILESTONE_TTL)
  await helper.setTripReadCache(timelineKey, { success: true }, helper.TIMELINE_TTL)
  await helper.setTripReadCache(locationKey, { success: true }, helper.COMPLETED_LOCATION_TTL)
  assert.deepEqual(calls.set.map(call => call[2]), [30, 10, 120, 1800])

  await helper.invalidateTripReadCache(tripId)
  assert.deepEqual(calls.delete, [
    'porttivo:trip:trip-3',
    'porttivo:trip:trip-3:milestone'
  ])
  assert.deepEqual(calls.patterns, [
    'porttivo:trip:trip-3:timeline:*',
    'porttivo:trip:trip-3:location-trail:completed:*',
    'driver:trips:*'
  ])
})

test('cache helper failure results never throw and report misses or failed writes', async () => {
  const cache = {
    getCache: async () => null,
    setCache: async () => false,
    deleteCache: async () => false,
    deleteCachePattern: async () => false
  }
  const notification = loadCacheHelper('notificationCache', cache)
  const unread = loadCacheHelper('unreadMessageCache', cache)
  const trip = loadCacheHelper('tripReadCache', cache)

  assert.equal(await notification.getNotificationCache('missing'), null)
  assert.equal(await notification.setNotificationCache('key', {}), false)
  assert.equal(await unread.setUnreadMessageCache('key', {}), false)
  assert.equal(await trip.setTripReadCache('key', {}, 30), false)
  await assert.doesNotReject(() => notification.invalidateNotificationCache('user'))
  await assert.doesNotReject(() => unread.invalidateUnreadMessageCache('user'))
  await assert.doesNotReject(() => trip.invalidateTripReadCache('trip'))
})

module.exports = tests
