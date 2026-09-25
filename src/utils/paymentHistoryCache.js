const crypto = require('crypto')
const { getCache, setCache, deleteCachePattern } = require('./cache')

const PAYMENT_HISTORY_TTL = 60
const PREFIX = 'porttivo:payment-history'
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const transporterPaymentHistoryKey = (userId, query) => `${PREFIX}:transporter:${userId}:${hash(query)}`
const adminPaymentHistoryKey = query => `${PREFIX}:admin:${hash(query)}`

const getPaymentHistoryCache = async key => {
  const value = await getCache(key)
  console.info(value ? `CACHE HIT ${key}` : `CACHE MISS ${key}`)
  return value
}
const setPaymentHistoryCache = async (key, value) => {
  const result = await setCache(key, value, PAYMENT_HISTORY_TTL)
  if (result) console.info(`SET ${key} TTL=${PAYMENT_HISTORY_TTL}`)
  return result
}
const invalidatePaymentHistoryCache = async () => {
  const pattern = `${PREFIX}:*`
  const result = await deleteCachePattern(pattern)
  if (result) console.info(`INVALIDATE ${pattern}`)
  return result
}

module.exports = {
  PAYMENT_HISTORY_TTL,
  transporterPaymentHistoryKey,
  adminPaymentHistoryKey,
  getPaymentHistoryCache,
  setPaymentHistoryCache,
  invalidatePaymentHistoryCache
}
