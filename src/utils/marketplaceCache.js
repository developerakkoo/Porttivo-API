const crypto = require('crypto')
const {
  getCache,
  setCache,
  deleteCachePattern
} = require('./cache')
const logger = require('./logger')

const MARKETPLACE_SEARCH_TTL = 25
const MARKETPLACE_POST_DETAIL_TTL = 30
const MARKETPLACE_BOOKING_LIST_TTL = 20
const MARKETPLACE_BOOKING_STATS_TTL = 45
const MARKETPLACE_PAYMENT_LIST_TTL = 45

const sortValue = value => {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value
  return Object.keys(value)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = sortValue(value[key])
      return sorted
    }, {})
}

const serializeStable = value => JSON.stringify(sortValue(value))
const hashValue = value =>
  crypto.createHash('sha256').update(serializeStable(value)).digest('hex')
const logCacheEvent = (event, details) => {
  try {
    logger.info(event, { scope: 'MARKETPLACE', ...details })
  } catch (error) {}
}

const normalizeSearchText = value =>
  value == null ? '' : String(value).trim().replace(/\s+/g, ' ').toLowerCase()

const searchDateKey = value => {
  const parsed = value == null || value === '' ? new Date() : new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`
}

const normalizePageValue = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : String(value)
}

const vehiclePostSearchKey = ({
  origin,
  destination,
  date,
  vehicleType,
  page = 1,
  limit = 20
} = {}) => {
  const query = {
    origin: normalizeSearchText(origin),
    destination: normalizeSearchText(destination),
    date: searchDateKey(date),
    vehicleType: vehicleType == null ? '' : String(vehicleType),
    page: normalizePageValue(page),
    limit: normalizePageValue(limit)
  }
  return `marketplace:posts:search:${hashValue(query)}`
}

const vehiclePostDetailKey = (postId, viewerScope) =>
  `marketplace:post:${String(postId)}:viewer:${hashValue(String(viewerScope))}`

const bookingListKey = (userId, query = {}) =>
  `marketplace:bookings:user:${String(userId)}:list:${hashValue(query)}`
const bookingStatsKey = userId =>
  `marketplace:bookings:user:${String(userId)}:stats`
const paymentListKey = (userId, query = {}) =>
  `marketplace:payments:user:${String(userId)}:list:${hashValue(query)}`
const normalizeCacheId = value => {
  const id = value && typeof value === 'object'
    ? value._id || value.id || value
    : value
  return id == null ? null : String(id)
}

const getMarketplaceCache = async key => {
  let value = null
  try {
    value = await getCache(key)
  } catch (error) {
    logCacheEvent('CACHE MISS', { key, error: error.message })
    return null
  }
  logCacheEvent(value ? 'CACHE HIT' : 'CACHE MISS', { key })
  return value
}

const setMarketplaceCache = async (key, value, ttlSeconds) => {
  let stored = false
  try {
    stored = await setCache(key, value, ttlSeconds)
  } catch (error) {
    return false
  }
  if (stored) {
    logCacheEvent('CACHE SET', { key, ttlSeconds })
  }
  return stored
}

const deleteMarketplacePattern = async pattern => {
  try {
    return await deleteCachePattern(pattern)
  } catch (error) {
    return false
  }
}

const invalidateMarketplaceSearchCache = async () => {
  const pattern = 'marketplace:posts:search:*'
  const invalidated = await deleteMarketplacePattern(pattern)
  logCacheEvent('CACHE INVALIDATION', { pattern, skipped: !invalidated })
  return invalidated
}

const invalidateMarketplacePostCache = async postId => {
  if (!postId) return false
  const pattern = `marketplace:post:${String(postId)}:*`
  const invalidated = await deleteMarketplacePattern(pattern)
  logCacheEvent('CACHE INVALIDATION', { pattern, skipped: !invalidated })
  return invalidated
}

const invalidateMarketplaceCaches = async postId => {
  const invalidations = [invalidateMarketplaceSearchCache()]
  if (postId) invalidations.push(invalidateMarketplacePostCache(postId))
  const results = await Promise.all(invalidations)
  return results.every(Boolean)
}

const invalidateMarketplaceBookingCaches = async (...userIds) => {
  const uniqueIds = [...new Set(userIds.map(normalizeCacheId).filter(Boolean))]
  const results = await Promise.all(uniqueIds.map(async userId => {
    const pattern = `marketplace:bookings:user:${userId}:*`
    const invalidated = await deleteMarketplacePattern(pattern)
    logCacheEvent('CACHE INVALIDATION', { pattern, skipped: !invalidated })
    return invalidated
  }))
  return results.every(Boolean)
}

const invalidateMarketplacePaymentCaches = async (...userIds) => {
  const uniqueIds = [...new Set(userIds.map(normalizeCacheId).filter(Boolean))]
  const results = await Promise.all(uniqueIds.map(async userId => {
    const pattern = `marketplace:payments:user:${userId}:*`
    const invalidated = await deleteMarketplacePattern(pattern)
    logCacheEvent('CACHE INVALIDATION', { pattern, skipped: !invalidated })
    return invalidated
  }))
  return results.every(Boolean)
}

module.exports = {
  MARKETPLACE_SEARCH_TTL,
  MARKETPLACE_POST_DETAIL_TTL,
  MARKETPLACE_BOOKING_LIST_TTL,
  MARKETPLACE_BOOKING_STATS_TTL,
  MARKETPLACE_PAYMENT_LIST_TTL,
  serializeStable,
  vehiclePostSearchKey,
  vehiclePostDetailKey,
  bookingListKey,
  bookingStatsKey,
  paymentListKey,
  getMarketplaceCache,
  setMarketplaceCache,
  invalidateMarketplaceSearchCache,
  invalidateMarketplacePostCache,
  invalidateMarketplaceCaches,
  invalidateMarketplaceBookingCaches,
  invalidateMarketplacePaymentCaches
}
