const crypto = require('crypto')
const { getCache, setCache, deleteCachePattern } = require('./cache')

const NOTIFICATION_TTL = 30
const NOTIFICATION_PREFIX = 'porttivo:notifications'

const hashQuery = query => crypto
  .createHash('sha256')
  .update(JSON.stringify(query))
  .digest('hex')

const notificationKey = (userId, query) =>
  `${NOTIFICATION_PREFIX}:${userId}:${hashQuery(query)}`

const getNotificationCache = async key => {
  const value = await getCache(key)
  console.info(`${value ? 'HIT' : 'MISS'} ${key}`)
  return value
}

const setNotificationCache = async (key, value) => {
  const result = await setCache(key, value, NOTIFICATION_TTL)
  if (result) console.info(`SET ${key} TTL=${NOTIFICATION_TTL}`)
  return result
}

const invalidateNotificationCache = async userId => {
  const pattern = `${NOTIFICATION_PREFIX}:${userId}:*`
  const result = await deleteCachePattern(pattern)
  if (result) console.info(`INVALIDATE ${pattern}`)
  return result
}

module.exports = {
  NOTIFICATION_TTL,
  notificationKey,
  getNotificationCache,
  setNotificationCache,
  invalidateNotificationCache
}