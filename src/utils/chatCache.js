const { getCache, setCache, deleteCache, deleteCachePattern } = require('./cache')

const CONVERSATION_TTL = 10
const UNREAD_TTL = 5
const PREFIX = 'porttivo:chat'
const conversationKey = (bookingId, page, limit) => `${PREFIX}:conversation:${bookingId}:page:${page}:limit:${limit}`
const unreadKey = userId => `${PREFIX}:unread:${userId}`

const getChatCache = async key => {
  const value = await getCache(key)
  console.info(value ? `CACHE HIT ${key}` : `CACHE MISS ${key}`)
  return value
}
const setConversationCache = async (key, value) => {
  const result = await setCache(key, value, CONVERSATION_TTL)
  if (result) console.info(`SET ${key} TTL=${CONVERSATION_TTL}`)
  return result
}
const setUnreadCache = async (key, value) => {
  const result = await setCache(key, value, UNREAD_TTL)
  if (result) console.info(`SET ${key} TTL=${UNREAD_TTL}`)
  return result
}
const invalidateChatCache = async ({ bookingId, userId }) => {
  const keys = []
  if (bookingId) keys.push({ key: `${PREFIX}:conversation:${bookingId}:*`, pattern: true })
  if (userId) keys.push({ key: unreadKey(userId), pattern: false })
  await Promise.all(keys.map(async ({ key, pattern }) => {
    const result = pattern ? await deleteCachePattern(key) : await deleteCache(key)
    if (result) console.info(`INVALIDATE ${key}`)
  }))
}

module.exports = {
  conversationKey,
  unreadKey,
  getChatCache,
  setConversationCache,
  setUnreadCache,
  invalidateChatCache,
  CONVERSATION_TTL,
  UNREAD_TTL
}
