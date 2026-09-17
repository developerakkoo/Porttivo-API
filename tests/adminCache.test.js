const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const loadAdminController = (cache, logs) =>
  loadWithMocks(path.resolve(__dirname, '..', 'src', 'controllers', 'admin.controller.js'), {
    '../models/Admin': {},
    '../models/Transporter': {
      find: () => ({
        select: () => ({
          sort: () => ({
            skip: () => ({ limit: async () => [{ _id: 'transporter-1', name: 'Fleet' }] }),
          }),
        }),
      }),
      countDocuments: async () => 1,
    },
    '../models/Driver': {},
    '../models/PumpOwner': {},
    '../models/PumpStaff': {},
    '../models/CompanyUser': {},
    '../models/Customer': {},
    '../models/Trip': {},
    '../models/Vehicle': {},
    '../models/VehicleRouteAvailability': {},
    '../models/VehicleRouteAssignment': {},
    '../models/VehicleBooking': {},
    '../models/FuelTransaction': {},
    '../models/Settlement': {},
    '../models/Wallet': {},
    '../models/SystemConfig': {},
    '../models/AdminAuditLog': {},
    '../models/AuditLog': {},
    '../models/SavedLocation': {},
    '../services/jwt.service': { generateTokens: () => ({}) },
    '../utils/tripState': {
      TRIP_STATUS: { ACTIVE: 'ACTIVE', PAUSED: 'PAUSED', POD_PENDING: 'POD_PENDING', CANCELLED: 'CANCELLED' },
      CLOSED_TRIP_STATUSES: ['CLOSED_WITH_POD', 'CLOSED_WITHOUT_POD'],
    },
    '../services/adminAudit.service': { logAdminAction: async () => {} },
    '../utils/cache': cache,
    '../utils/logger': {
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
  })

test('admin transporter list caches MISS/HIT and isolates query variations', { concurrency: false }, async () => {
  const cacheStore = new Map()
  const writes = []
  const logs = []
  const cache = {
    getCache: async (key) => cacheStore.get(key) || null,
    setCache: async (key, value, ttl) => {
      cacheStore.set(key, value)
      writes.push({ key, ttl })
      return true
    },
    deleteCache: async () => true,
    deleteCachePattern: async () => true,
  }
  const controller = loadAdminController(cache, logs)
  const user = { id: 'admin-1', userType: 'admin' }
  const first = createMockRes()
  const second = createMockRes()

  await controller.listAllTransporters({ user, query: { page: '1', limit: '20', status: 'active' } }, first, (error) => { throw error })
  await controller.listAllTransporters({ user, query: { page: '1', limit: '20', status: 'active' } }, second, (error) => { throw error })
  await controller.listAllTransporters({ user, query: { page: '2', limit: '20', status: 'active' } }, createMockRes(), (error) => { throw error })

  assert.deepEqual(second.body, first.body)
  assert.equal(writes.length, 2)
  assert.equal(writes[0].ttl, 60)
  assert.equal(cacheStore.size, 2)
  assert.equal(logs.filter((entry) => entry[1] === 'ADMIN CACHE HIT').length, 1)
  assert.equal(logs.filter((entry) => entry[1] === 'ADMIN CACHE MISS').length, 2)
  assert.equal(logs.filter((entry) => entry[1] === 'ADMIN DB QUERY').length, 2)
})

test('admin cache invalidation logs patterns after transporter status update', { concurrency: false }, async () => {
  const patterns = []
  const logs = []
  const controller = loadWithMocks(path.resolve(__dirname, '..', 'src', 'controllers', 'admin.controller.js'), {
    '../models/Admin': {},
    '../models/Transporter': {
      findByIdAndUpdate: () => ({ select: async () => ({ _id: 'transporter-1', status: 'inactive' }) }),
    },
    '../models/Driver': {}, '../models/PumpOwner': {}, '../models/PumpStaff': {}, '../models/CompanyUser': {},
    '../models/Customer': {}, '../models/Trip': {}, '../models/Vehicle': {}, '../models/VehicleRouteAvailability': {},
    '../models/VehicleRouteAssignment': {}, '../models/VehicleBooking': {}, '../models/FuelTransaction': {},
    '../models/Settlement': {}, '../models/Wallet': {}, '../models/SystemConfig': {}, '../models/AdminAuditLog': {},
    '../models/AuditLog': {}, '../models/SavedLocation': {},
    '../services/jwt.service': { generateTokens: () => ({}) },
    '../utils/tripState': { TRIP_STATUS: {}, CLOSED_TRIP_STATUSES: [] },
    '../services/adminAudit.service': { logAdminAction: async () => {} },
    '../utils/cache': {
      getCache: async () => null, setCache: async () => true, deleteCache: async () => true,
      deleteCachePattern: async (pattern) => patterns.push(pattern),
    },
    '../utils/logger': { info: (...args) => logs.push(['info', ...args]), warn: () => {}, error: () => {} },
  })

  const res = createMockRes()
  await controller.updateTransporterStatus(
    { params: { id: 'transporter-1' }, body: { status: 'inactive' }, user: { id: 'admin-1' } },
    res,
    (error) => { throw error }
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(patterns, ['admin:dashboard-stats:*', 'admin:analytics:*', 'admin:transporters:*'])
  assert.ok(logs.some((entry) => entry[1] === 'ADMIN CACHE INVALIDATION'))
})
