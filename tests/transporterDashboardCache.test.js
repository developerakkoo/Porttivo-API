const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const createController = (overrides = {}) =>
  loadWithMocks(path.resolve(__dirname, '..', 'src', 'controllers', 'transporter.controller.js'), {
    '../models/Transporter': {},
    '../models/Vehicle': overrides.Vehicle || { countDocuments: async () => 0 },
    '../models/Trip': overrides.Trip || { countDocuments: async () => 0 },
    '../models/Driver': overrides.Driver || { countDocuments: async () => 0 },
    '../utils/cache': overrides.cache || {
      getCache: async () => null,
      setCache: async () => true,
      deleteCache: async () => true,
    },
    '../utils/logger': overrides.logger || {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  })

test('dashboard cache MISS queries MongoDB, caches for 120 seconds, and logs phases', async () => {
  const cacheWrites = []
  const logs = []
  const counts = []
  const logger = {
    info: (...args) => logs.push(['info', ...args]),
    warn: (...args) => logs.push(['warn', ...args]),
    error: (...args) => logs.push(['error', ...args]),
  }
  const countDocuments = async (query) => {
    counts.push(query)
    return counts.length
  }
  const controller = createController({
    Vehicle: { countDocuments },
    Trip: { countDocuments },
    Driver: { countDocuments },
    logger,
    cache: {
      getCache: async () => null,
      setCache: async (...args) => {
        cacheWrites.push(args)
        return true
      },
      deleteCache: async () => true,
    },
  })
  const res = createMockRes()

  await controller.getDashboard(
    { user: { id: 'transporter-1', userType: 'transporter' } },
    res,
    (error) => { throw error }
  )

  assert.equal(res.statusCode, 200)
  assert.equal(counts.length, 6)
  assert.equal(cacheWrites.length, 1)
  assert.equal(cacheWrites[0][0], 'transporter:dashboard:transporter-1')
  assert.equal(cacheWrites[0][2], 120)
  assert.ok(logs.some((entry) => entry[1] === 'DASHBOARD CACHE MISS'))
  assert.ok(logs.some((entry) => entry[1] === 'DASHBOARD DB QUERY'))
  assert.ok(logs.some((entry) => entry[1] === 'DASHBOARD CACHE SET'))
})

test('dashboard cache HIT returns Redis data without MongoDB queries', async () => {
  const cachedResponse = {
    success: true,
    data: { dashboard: { totalVehicles: 9 } },
  }
  const logs = []
  const logger = {
    info: (...args) => logs.push(['info', ...args]),
    warn: (...args) => logs.push(['warn', ...args]),
    error: () => {},
  }
  const shouldNotQuery = async () => {
    throw new Error('MongoDB should not be queried on dashboard cache HIT')
  }
  const controller = createController({
    Vehicle: { countDocuments: shouldNotQuery },
    Trip: { countDocuments: shouldNotQuery },
    Driver: { countDocuments: shouldNotQuery },
    logger,
    cache: {
      getCache: async (key) => {
        assert.equal(key, 'transporter:dashboard:transporter-1')
        return cachedResponse
      },
      setCache: async () => true,
      deleteCache: async () => true,
    },
  })
  const res = createMockRes()

  await controller.getDashboard(
    { user: { id: 'transporter-1', userType: 'transporter' } },
    res,
    (error) => { throw error }
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, cachedResponse)
  assert.ok(logs.some((entry) => entry[1] === 'DASHBOARD CACHE HIT'))
  assert.equal(logs.some((entry) => entry[1] === 'DASHBOARD DB QUERY'), false)
})
