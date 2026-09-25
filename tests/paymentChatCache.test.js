const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')

const paymentPath = path.resolve(process.cwd(), 'src/utils/paymentHistoryCache.js')
const chatPath = path.resolve(process.cwd(), 'src/utils/chatCache.js')

const makeCacheMock = ({ value = null, fail = false } = {}) => {
  const calls = { get: [], set: [], delete: [], pattern: [] }
  return {
    calls,
    getCache: async key => { calls.get.push(key); return fail ? null : value },
    setCache: async (key, data, ttl) => { calls.set.push({ key, data, ttl }); return !fail },
    deleteCache: async key => { calls.delete.push(key); return !fail },
    deleteCachePattern: async pattern => { calls.pattern.push(pattern); return !fail }
  }
}

module.exports = [
  {
    name: 'payment history cache uses hashed keys, 60 second TTL, and invalidation',
    async run () {
      const cache = makeCacheMock()
      const helper = loadWithMocks(paymentPath, { './cache': cache })
      const key = helper.transporterPaymentHistoryKey('user-1', { page: 1 })
      assert.match(key, /^porttivo:payment-history:transporter:user-1:[a-f0-9]{64}$/)
      await helper.setPaymentHistoryCache(key, { success: true })
      assert.equal(cache.calls.set[0].ttl, 60)
      await helper.invalidatePaymentHistoryCache()
      assert.deepEqual(cache.calls.pattern, ['porttivo:payment-history:*'])
    }
  },
  {
    name: 'payment history cache handles HIT, MISS, and Redis failure',
    async run () {
      const hitCache = makeCacheMock({ value: { data: 1 } })
      const hitHelper = loadWithMocks(paymentPath, { './cache': hitCache })
      assert.deepEqual(await hitHelper.getPaymentHistoryCache('key'), { data: 1 })
      const failedCache = makeCacheMock({ fail: true })
      const failedHelper = loadWithMocks(paymentPath, { './cache': failedCache })
      assert.equal(await failedHelper.getPaymentHistoryCache('key'), null)
      assert.equal(await failedHelper.setPaymentHistoryCache('key', {}), false)
      assert.equal(await failedHelper.invalidatePaymentHistoryCache(), false)
    }
  },
  {
    name: 'chat cache uses required keys and 10/5 second TTLs',
    async run () {
      const cache = makeCacheMock()
      const helper = loadWithMocks(chatPath, { './cache': cache })
      assert.equal(helper.conversationKey('booking-1', 2, 50), 'porttivo:chat:conversation:booking-1:page:2:limit:50')
      assert.equal(helper.unreadKey('user-1'), 'porttivo:chat:unread:user-1')
      await helper.setConversationCache('conversation-key', {})
      await helper.setUnreadCache('unread-key', {})
      assert.deepEqual(cache.calls.set.map(call => call.ttl), [10, 5])
      await helper.invalidateChatCache({ bookingId: 'booking-1', userId: 'user-1' })
      assert.deepEqual(cache.calls.pattern, ['porttivo:chat:conversation:booking-1:*'])
      assert.deepEqual(cache.calls.delete, ['porttivo:chat:unread:user-1'])
    }
  }
]
