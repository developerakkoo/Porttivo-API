const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const loadController = (cache, logs) => loadWithMocks(
  path.resolve(__dirname, '..', 'src/controllers/supportTicket.controller.js'),
  {
    '../models/SupportTicket': {
      find: () => {
        const chain = {
          sort: () => chain,
          skip: () => chain,
          limit: () => chain,
          populate: () => chain,
          lean: async () => [],
        }
        return chain
      },
      countDocuments: async () => 0,
    },
    '../models/SupportTicketEvent': {},
    '../services/socket.service': { getIO: () => null },
    '../utils/transporterActor': {},
    '../services/supportTicket.service': {},
    '../utils/cache': cache,
    '../utils/logger': { info: (...args) => logs.push(args), warn: () => {}, error: () => {} },
  }
)

test('admin support categories cache HIT/MISS and authorizes before Redis', { concurrency: false }, async () => {
  const store = new Map()
  let reads = 0
  const logs = []
  const controller = loadController({
    getCache: async (key) => {
      reads += 1
      return store.get(key) || null
    },
    setCache: async (key, value, ttl) => {
      store.set(key, value)
      assert.equal(ttl, 60)
      return true
    },
    deleteCachePattern: async () => true,
  }, logs)

  const denied = createMockRes()
  await controller.getSupportCategoriesAdmin(
    { user: { id: 'user-1', userType: 'transporter' }, query: {} },
    denied,
    (error) => { throw error }
  )
  assert.equal(denied.statusCode, 403)
  assert.equal(reads, 0)

  const first = createMockRes()
  await controller.getSupportCategoriesAdmin(
    { user: { id: 'admin-1', userType: 'admin' }, query: {} },
    first,
    (error) => { throw error }
  )
  const second = createMockRes()
  await controller.getSupportCategoriesAdmin(
    { user: { id: 'admin-1', userType: 'admin' }, query: {} },
    second,
    (error) => { throw error }
  )

  assert.deepEqual(second.body, first.body)
  assert.equal(reads, 2)
  assert.ok(logs.some((entry) => entry[0] === 'CACHE HIT'))
  assert.ok(logs.some((entry) => entry[0] === 'CACHE MISS'))
  assert.ok(logs.some((entry) => entry[0] === 'DB QUERY'))
  assert.ok(logs.some((entry) => entry[0] === 'CACHE SET'))
})

test('admin support ticket cache separates query filters and skips failed Redis SET', { concurrency: false }, async () => {
  const keys = []
  const logs = []
  const controller = loadController({
    getCache: async (key) => {
      keys.push(key)
      return null
    },
    setCache: async () => false,
    deleteCachePattern: async () => true,
  }, logs)
  const user = { id: 'admin-1', userType: 'admin' }

  for (const query of [{ status: 'OPEN' }, { status: 'CLOSED' }]) {
    const res = createMockRes()
    await controller.listTicketsAdmin({ user, query }, res, (error) => { throw error })
    assert.equal(res.statusCode, 200)
  }

  assert.equal(new Set(keys).size, 2)
  assert.ok(logs.some((entry) => entry[0] === 'CACHE SET SKIPPED'))
  assert.ok(logs.some((entry) => entry[0] === 'DB QUERY'))
})