const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const requirementQuotesCacheTests = [
  {
    name: 'GET /api/requirements/:id/quotes MISS fetches from DB, caches response with key requirement:id:quotes:viewerId and 60s TTL',
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
        requesterId: 'user-requester',
        createdAt: new Date()
      }

      const mockQuotes = [
        {
          _id: 'quote-1',
          requirementId: 'req-101',
          transporterId: {
            _id: 'transporter-1',
            name: 'Fleet Co',
            company: 'Fleet Logistics',
            rating: 4.8,
            ratingCount: 12
          },
          price: 4500,
          availability: 'TODAY',
          availabilityDate: null,
          message: 'Best rate',
          status: 'SUBMITTED',
          counterPrice: null,
          createdAt: new Date()
        }
      ]

      const quoteController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/quote.controller.js'),
        {
          '../models/Requirement': {
            findById: (id) => {
              dbQueryCount++
              return {
                lean: async () => (id === 'req-101' ? mockRequirement : null)
              }
            }
          },
          '../models/Quote': {
            find: (query) => {
              dbQueryCount++
              return {
                sort: () => ({
                  populate: () => ({
                    lean: async () => (query.requirementId === 'req-101' ? mockQuotes : [])
                  })
                })
              }
            }
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-requester'
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
          user: { id: 'user-requester' },
          params: { id: 'req-101' }
        }
        const res = createMockRes()

        await quoteController.getQuotesForRequirement(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 200)
        assert.equal(res.body.success, true)
        assert.equal(res.body.data.quotes.length, 1)
        assert.equal(res.body.data.quotes[0].id, 'quote-1')
        assert.equal(dbQueryCount, 2) // Requirement.findById + Quote.find

        // Verify cache key format requirement:id:quotes:viewerId and 60s TTL
        const expectedKey = 'requirement:req-101:quotes:user-requester'
        assert.ok(cacheStore.has(expectedKey))
        assert.equal(cacheStore.get(expectedKey).ttl, 60)

        // Check logs
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT QUOTES CACHE MISS' && l[1]?.cacheKey === expectedKey))
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT QUOTES CACHE SET' && l[1]?.cacheKey === expectedKey))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'GET /api/requirements/:id/quotes HIT returns cached response without querying MongoDB',
    async run() {
      const cacheStore = new Map()
      const cachedData = {
        success: true,
        data: {
          quotes: [
            {
              id: 'quote-1',
              requirementId: 'req-101',
              price: 4500,
              status: 'SUBMITTED'
            }
          ]
        }
      }
      const expectedKey = 'requirement:req-101:quotes:user-requester'
      cacheStore.set(expectedKey, cachedData)

      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      let dbQueried = false

      const quoteController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/quote.controller.js'),
        {
          '../models/Requirement': {
            findById: () => {
              dbQueried = true
              throw new Error('Database should not be queried on cache HIT')
            }
          },
          '../models/Quote': {
            find: () => {
              dbQueried = true
              throw new Error('Database should not be queried on cache HIT')
            }
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-requester'
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
          user: { id: 'user-requester' },
          params: { id: 'req-101' }
        }
        const res = createMockRes()

        await quoteController.getQuotesForRequirement(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 200)
        assert.deepEqual(res.body, cachedData)
        assert.equal(dbQueried, false)
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT QUOTES CACHE HIT' && l[1]?.cacheKey === expectedKey))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'Invalidation: submitQuote invalidates quotes cache pattern requirement:id:quotes:*',
    async run() {
      const invalidatedPatterns = []
      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      const quoteController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/quote.controller.js'),
        {
          '../models/Requirement': {
            findById: async () => ({
              _id: 'req-101',
              requesterId: 'user-requester',
              origin: 'Mumbai',
              destination: 'Pune',
              status: 'OPEN'
            })
          },
          '../models/Quote': {
            findOneAndUpdate: async () => ({
              _id: 'quote-1'
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'transporter-1'
          },
          '../services/pushNotification.service': {
            notifyUser: async () => {}
          },
          '../utils/cache': {
            getCache: async () => null,
            setCache: async () => true,
            deleteCachePattern: async (pattern) => {
              invalidatedPatterns.push(pattern)
              return true
            }
          }
        }
      )

      try {
        const req = {
          user: { id: 'transporter-1' },
          params: { id: 'req-101' },
          body: { price: 5000, availability: 'TODAY' }
        }
        const res = createMockRes()

        await quoteController.submitQuote(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 201)
        assert.ok(invalidatedPatterns.includes('requirement:req-101:quotes:*'))
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT QUOTES CACHE INVALIDATE' && l[1]?.pattern === 'requirement:req-101:quotes:*'))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'Invalidation: counterQuote invalidates quotes cache pattern requirement:id:quotes:*',
    async run() {
      const invalidatedPatterns = []
      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      const quoteController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/quote.controller.js'),
        {
          '../models/Quote': {
            findById: async () => ({
              _id: 'quote-1',
              requirementId: 'req-101',
              transporterId: 'transporter-1',
              status: 'SUBMITTED',
              save: async () => {}
            })
          },
          '../models/Requirement': {
            findById: async () => ({
              _id: 'req-101',
              requesterId: 'user-requester',
              status: 'OPEN'
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-requester'
          },
          '../services/pushNotification.service': {
            notifyUser: async () => {}
          },
          '../utils/cache': {
            getCache: async () => null,
            setCache: async () => true,
            deleteCachePattern: async (pattern) => {
              invalidatedPatterns.push(pattern)
              return true
            }
          }
        }
      )

      try {
        const req = {
          user: { id: 'user-requester' },
          params: { id: 'quote-1' },
          body: { counterPrice: 4000 }
        }
        const res = createMockRes()

        await quoteController.counterQuote(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 200)
        assert.ok(invalidatedPatterns.includes('requirement:req-101:quotes:*'))
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT QUOTES CACHE INVALIDATE' && l[1]?.pattern === 'requirement:req-101:quotes:*'))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'Invalidation: withdrawQuote invalidates quotes cache pattern requirement:id:quotes:*',
    async run() {
      const invalidatedPatterns = []
      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      const quoteController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/quote.controller.js'),
        {
          '../models/Quote': {
            findById: async () => ({
              _id: 'quote-1',
              requirementId: 'req-101',
              transporterId: 'transporter-1',
              status: 'SUBMITTED',
              save: async () => {}
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'transporter-1'
          },
          '../utils/cache': {
            getCache: async () => null,
            setCache: async () => true,
            deleteCachePattern: async (pattern) => {
              invalidatedPatterns.push(pattern)
              return true
            }
          }
        }
      )

      try {
        const req = {
          user: { id: 'transporter-1' },
          params: { id: 'quote-1' }
        }
        const res = createMockRes()

        await quoteController.withdrawQuote(req, res, (err) => {
          throw err
        })

        assert.equal(res.statusCode, 200)
        assert.ok(invalidatedPatterns.includes('requirement:req-101:quotes:*'))
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT QUOTES CACHE INVALIDATE' && l[1]?.pattern === 'requirement:req-101:quotes:*'))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'Invalidation: cancelRequirement invalidates quotes cache pattern requirement:id:quotes:*',
    async run() {
      const invalidatedPatterns = []
      const logs = []
      const originalLog = console.log
      console.log = (...args) => {
        logs.push(args)
        originalLog(...args)
      }

      const requirementController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/requirement.controller.js'),
        {
          './quote.controller': {
            invalidateRequirementQuotesCache: async (id) => {
              const pattern = `requirement:${id}:quotes:*`
              invalidatedPatterns.push(pattern)
              console.log('REQUIREMENT QUOTES CACHE INVALIDATE', { pattern })
            }
          },
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
            deleteCachePattern: async () => true
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
        assert.ok(invalidatedPatterns.includes('requirement:req-202:quotes:*'))
        assert.ok(logs.some((l) => l[0] === 'REQUIREMENT QUOTES CACHE INVALIDATE' && l[1]?.pattern === 'requirement:req-202:quotes:*'))
      } finally {
        console.log = originalLog
      }
    }
  },
  {
    name: 'Redis failure does not break GET /api/requirements/:id/quotes API',
    async run() {
      const mockRequirement = {
        _id: 'req-303',
        requesterId: 'user-requester',
        createdAt: new Date()
      }

      const mockQuotes = []

      // Cache functions fail gracefully returning null / false
      const quoteController = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/quote.controller.js'),
        {
          '../models/Requirement': {
            findById: () => ({
              lean: async () => mockRequirement
            })
          },
          '../models/Quote': {
            find: () => ({
              sort: () => ({
                populate: () => ({
                  lean: async () => mockQuotes
                })
              })
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'user-requester'
          },
          '../utils/cache': {
            getCache: async () => null,
            setCache: async () => false,
            deleteCachePattern: async () => false
          }
        }
      )

      const req = {
        user: { id: 'user-requester' },
        params: { id: 'req-303' }
      }
      const res = createMockRes()

      await quoteController.getQuotesForRequirement(req, res, (err) => {
        throw err
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.deepEqual(res.body.data.quotes, [])
    }
  }
]

module.exports = requirementQuotesCacheTests

