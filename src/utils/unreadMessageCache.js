const { getCache, setCache, deleteCache } = require('./cache')

const UNREAD_MESSAGE_TTL = 10
const unreadMessageKey = userId => `porttivo:messages:unread:${userId}`

const getUnreadMessageCache = async key => {
  const value = await getCache(key)
  console.info(`${value ? 'HIT' : 'MISS'} ${key}`)
  return value
}

const setUnreadMessageCache = async (key, value) => {
  const result = await setCache(key, value, UNREAD_MESSAGE_TTL)
  if (result) console.info(`SET ${key} TTL=${UNREAD_MESSAGE_TTL}`)
  return result
}

const invalidateUnreadMessageCache = async userId => {
  const key = unreadMessageKey(userId)
  const result = await deleteCache(key)
  if (result) console.info(`INVALIDATE ${key}`)
  return result
}

module.exports = {
  UNREAD_MESSAGE_TTL,
  unreadMessageKey,
  getUnreadMessageCache,
  setUnreadMessageCache,
  invalidateUnreadMessageCache
}