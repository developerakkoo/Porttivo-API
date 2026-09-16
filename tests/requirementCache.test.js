const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const requirementCacheTests = [
  {
    name: 'GET /api/requirements/:id MISS fetches from DB, caches response with key requirement:id:viewerId and 120s TTL',
    async run() {
      const cacheStore = new Map()
      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      let dbQueryCount = 0

      const mockRequirement = {
        _id: 'req-101',
        ref: 'REQ-101',
        requesterId: {
          _id: 'user-requester',
          name: 'Requester Name',
          company: 'Requester Co',
          mobile: '9876543210'
        },
        origin: { formattedAddress: 'Mumbai' },
        destination: { formattedAddress: 'Pune' },
        vehicleType: 'CONTAINER_32FT',
        direction: 'EXPORT',
        noOfVehicles: 2,
        requiredBy: new Date('2026-10-01'),
        remarks: 'Handle with care',
        status: 'OPEN',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const requirementController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/requirement.controller.js'),
        {
          '../models/Requirement': {
            findById: (id) => {
              dbQueryCount++
              return {
                populate: () => ({
                  lean: async () => (id === 'req-101' ? mockRequirement : null)
                })
              }
            }
          },
          '../models/Quote': {
            countDocuments: async () => 1,
            findOne: () => ({
              lean: async () => ({
                _id: 'quote-1',
                price: 5000,
                status: 'SUBMITTED',
                availability: 'TODAY'
              })
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-transporter'
          },
          '../utils/cache': {
            getCache: async (key) => cacheStore.get(key) || null,
            setCache: async (key, val, ttl) => {
              cacheStore.set(key, { val, ttl })
              return true
            },
            deleteCachePattern: async (pattern) => {
              for (const k of cacheStore.keys()) {
                if (k.startsWith(pattern.replace('*', ''))) {
                  cacheStore.delete(k)
                }
              }
              return true
            }
          }
        }
      )

      try {
        const req = {
          user: { id: 'user-transporter' },
          params: { id: 'req-101' }
        }
        const res = createMockRes()

        await requirementController.getRequirementById(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 200)
        assert.equal(res.body.success, true)
        assert.equal(res.body.data.requirement.id, 'req-101')
        assert.equal(dbQueryCount, 1)

        // Verify cache store
        const expectedKey = 'requirement:req-101:user-transporter'
        assert.ok(cacheStore.has(expectedKey))
        assert.equal(cacheStore.get(expectedKey).ttl, 120)

        // Check logs
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT CACHE MISS' && l[1]?.cacheKey === expectedKey))
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT CACHE SET' && l[1]?.cacheKey === expectedKey))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'GET /api/requirements/:id HIT returns cached response without querying MongoDB',
    async run() {
      const cacheStore = new Map()
      const cachedData = {
        success: true,
        data: {
          requirement: {
            id: 'req-101',
            status: 'OPEN',
            quoteCount: 1,
            isOwner: false
          }
        }
      }
      cacheStore.set('requirement:req-101:user-transporter', cachedData)

      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      let dbQueried = false

      const requirementController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/requirement.controller.js'),
        {
          '../models/Requirement': {
            findById: () => {
              dbQueried = true
              throw new Error('Database should not be queried on cache HIT')
            }
          },
          '../models/Quote': {
            countDocuments: () => {
              dbQueried = true
              throw new Error('Database should not be queried on cache HIT')
            }
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-transporter'
          },
          '../utils/cache': {
            getCache: async (key) => cacheStore.get(key) || null,
            setCache: async () => true,
            deleteCachePattern: async () => true
          }
        }
      )

      try {
        const req = {
          user: { id: 'user-transporter' },
          params: { id: 'req-101' }
        }
        const res = createMockRes()

        await requirementController.getRequirementById(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.body, cachedData)
        assert.equal(dbQueried, false)
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT CACHE HIT' && l[1]?.cacheKey === 'requirement:req-101:user-transporter'))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'Invalidation: cancelRequirement invalidates requirement cache pattern requirement:id:*',
    async run() {
      let invalidatedPattern = null
      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      const requirementController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/requirement.controller.js'),
        {
          '../models/Requirement': {
            findById: async (id) => ({
              _id: id,
              requesterId: 'user-requester',
              status: 'OPEN',
              save: async function () {
                this.status = 'CANCELLED'
              }
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-requester'
          },
          '../utils/cache': {
            getCache: async () => null,
            setCache: async () => true,
            deleteCachePattern: async (pattern) => {
              invalidatedPattern = pattern
              return true
            }
          }
        }
      )

      try {
        const req = {
          user: { id: 'user-requester' },
          params: { id: 'req-202' }
        }
        const res = createMockRes()

        await requirementController.cancelRequirement(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 200)
        assert.equal(invalidatedPattern, 'requirement:req-202:*')
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT CACHE INVALIDATE' && l[1]?.pattern === 'requirement:req-202:*'))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'Redis failure does not break GET /api/requirements/:id API',
    async run() {
      const mockRequirement = {
        _id: 'req-303',
        ref: 'REQ-303',
        requesterId: 'user-requester',
        origin: 'Delhi',
        destination: 'Jaipur',
        vehicleType: 'TRAILER_40FT',
        direction: 'LOCAL',
        noOfVehicles: 1,
        status: 'OPEN',
        createdAt: new Date(),
        updatedAt: new Date()
      }

      // Test with failing cache functions returning null/false (as src/utils/cache.js does when Redis errors)
      const requirementController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/requirement.controller.js'),
        {
          '../models/Requirement': {
            findById: () => ({
              populate: () => ({
                lean: async () => mockRequirement
              })
            })
          },
          '../models/Quote': {
            countDocuments: async () => 0,
            findOne: () => ({
              lean: async () => null
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-requester'
          },
          '../utils/cache': {
            getCache: async () => null, // Redis GET error returns null
            setCache: async () => false, // Redis SET error returns false
            deleteCachePattern: async () => false
          }
        }
      )

      const req = {
        user: { id: 'user-requester' },
        params: { id: 'req-303' }
      }
      const res = createMockRes()

      await requirementController.getRequirementById(req, res, (err) => {
        throw err
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.data.requirement.id, 'req-303')
    }
  }
]

module.exports = requirementCacheTests

