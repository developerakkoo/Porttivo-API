const crypto = require('crypto')
const {
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern
} = require('./cache')
const logger = require('./logger')

const TRIP_TTL = 30
const MILESTONE_TTL = 10
const TIMELINE_TTL = 120
const COMPLETED_LOCATION_TTL = 30 * 60

const sortQuery = value => {
  if (Array.isArray(value)) return value.map(sortQuery)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortQuery(value[key])
    return result
  }, {})
}

const queryHash = query => crypto
  .createHash('sha256')
  .update(JSON.stringify(sortQuery(query)))
  .digest('hex')

const tripKey = tripId => `porttivo:trip:${tripId}`
const milestoneKey = tripId => `porttivo:trip:${tripId}:milestone`
const timelineKey = (tripId, query) =>
  `porttivo:trip:${tripId}:timeline:${queryHash(query)}`
const completedLocationKey = (tripId, query) =>
  `porttivo:trip:${tripId}:location-trail:completed:${queryHash(query)}`

const getTripReadCache = async key => {
  const value = await getCache(key)
  console.info(`${value ? 'HIT' : 'MISS'} ${key}`)
  return value
}

const setTripReadCache = async (key, value, ttl) => {
  const result = await setCache(key, value, ttl)
  if (result) console.info(`SET ${key} TTL=${ttl}`)
  return result
}

const invalidateTripReadCache = async tripId => {
  const keys = [
    tripKey(tripId),
    milestoneKey(tripId),
    `porttivo:trip:${tripId}:timeline:*`,
    `porttivo:trip:${tripId}:location-trail:completed:*`
  ]
  await Promise.all(keys.map(async key => {
    const isPattern = key.endsWith('*')
    const result = isPattern
      ? await deleteCachePattern(key)
      : await deleteCache(key)
    if (result) console.info(`INVALIDATE ${key}`)
  }))

  const driverTripPattern = 'driver:trips:*'
  const driverCacheInvalidated = await deleteCachePattern(driverTripPattern)
  logger.info('CACHE INVALIDATION', {
    pattern: driverTripPattern,
    tripId,
    skipped: !driverCacheInvalidated
  })
}

module.exports = {
  TRIP_TTL,
  MILESTONE_TTL,
  TIMELINE_TTL,
  COMPLETED_LOCATION_TTL,
  tripKey,
  milestoneKey,
  timelineKey,
  completedLocationKey,
  getTripReadCache,
  setTripReadCache,
  invalidateTripReadCache
}