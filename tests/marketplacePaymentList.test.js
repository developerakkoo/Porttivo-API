const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const mockFindChain = docs => ({
  sort: () => ({
    skip: () => ({
      limit: () => ({
        lean: async () => docs
      })
    })
  })
})

const loadListController = (overrides = {}) =>
  loadWithMocks(
    path.resolve(process.cwd(), 'src/controllers/marketplacePayment.controller.js'),
    {
      '../models/Trip': {},
      '../models/VehicleBooking': {},
      '../models/MarketplacePayment': {
        find: overrides.find || (() => mockFindChain([])),
        countDocuments: overrides.countDocuments || (async () => 0),
        findOne: () => ({
          sort: () => ({
            lean: async () => null
          })
        })
      },
      '../models/Notification': { create: async () => ({}) },
      '../models/Payout': { findOne: () => ({ sort: () => ({ lean: async () => null }) }) },
      '../utils/transporterActor': {
        getTransporterActorId: overrides.getTransporterActorId ||
          (user => user?.id || null)
      },
      '../utils/marketplaceCache': overrides.marketplaceCache || {
        MARKETPLACE_PAYMENT_LIST_TTL: 45,
        paymentListKey: (userId, query) =>
          `marketplace:payments:user:${userId}:${JSON.stringify(query)}`,
        getMarketplaceCache: async () => null,
        setMarketplaceCache: async () => true,
        invalidateMarketplacePaymentCaches: async () => true
      },
      '../services/tripAccess.service': {
        canTransporterPartyViewTripExecution: async () => true,
        isMarketplaceBookingTrip: () => true
      },
      '../services/paymentGateway.service': {
        getGatewayPayloadMetadata: () => ({}),
        verifyGatewayWebhook: () => true
      },
      '../services/cashfreePayout.service': {
        createAutomaticPayoutForPayment: async () => null
      },
      '../services/razorpayPayout.service': {
        isPayeePayoutReady: async () => ({ ready: true })
      },
      '../services/marketplacePayment.service': {
        createMarketplacePaymentRequestForTrip: async () => ({})
      }
    }
  )

const marketplacePaymentListTests = [
  {
    name: 'GET marketplace payments lists rows for payer or beneficiary with role',
    async run() {
      const docs = [
        {
          _id: 'pay-1',
          publicId: 'mp_payer',
          tripId: 'trip-1',
          bookingId: 'booking-1',
          payerTransporterId: 'transporter-me',
          beneficiaryTransporterId: 'transporter-other',
          amount: 15000,
          status: 'SUCCESS',
          currency: 'INR',
          provider: 'RAZORPAY',
          providerOrderId: 'order_1',
          providerTransactionId: 'pay_1',
          createdAt: '2026-09-01T10:00:00.000Z',
          completedAt: '2026-09-01T10:05:00.000Z',
          initiatedAt: '2026-09-01T10:00:00.000Z'
        },
        {
          _id: 'pay-2',
          publicId: 'mp_bene',
          tripId: 'trip-2',
          bookingId: 'booking-2',
          payerTransporterId: 'transporter-other',
          beneficiaryTransporterId: 'transporter-me',
          amount: 8000,
          status: 'PENDING',
          currency: 'INR',
          provider: 'RAZORPAY',
          createdAt: '2026-09-02T10:00:00.000Z'
        }
      ]

      let capturedFilter = null
      const controller = loadListController({
        find: filter => {
          capturedFilter = filter
          return mockFindChain(docs)
        },
        countDocuments: async () => 2
      })

      const req = {
        user: { id: 'transporter-me', userType: 'transporter' },
        query: { page: '1', limit: '20' }
      }
      const res = createMockRes()

      await controller.listMarketplacePayments(req, res, err => {
        throw err
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.data.payments.length, 2)
      assert.equal(res.body.data.payments[0].role, 'payer')
      assert.equal(res.body.data.payments[0].tripId, 'trip-1')
      assert.equal(res.body.data.payments[0].bookingId, 'booking-1')
      assert.equal(res.body.data.payments[0].amount, 15000)
      assert.equal(res.body.data.payments[0].status, 'SUCCESS')
      assert.equal(res.body.data.payments[1].role, 'beneficiary')
      assert.equal(res.body.data.pagination.total, 2)
      assert.equal(res.body.data.pagination.page, 1)
      assert.deepEqual(capturedFilter, {
        $or: [
          { payerTransporterId: 'transporter-me' },
          { beneficiaryTransporterId: 'transporter-me' }
        ]
      })
    }
  },
  {
    name: 'GET marketplace payments rejects non-transporter actors',
    async run() {
      const controller = loadListController({
        getTransporterActorId: () => null
      })
      const req = { user: { id: 'admin-1', userType: 'admin' }, query: {} }
      const res = createMockRes()

      await controller.listMarketplacePayments(req, res, err => {
        throw err
      })

      assert.equal(res.statusCode, 403)
      assert.equal(res.body.success, false)
    }
  },
  {
    name: 'GET marketplace payments caches per transporter and pagination',
    async run() {
      const cached = new Map()
      const ttls = new Map()
      const marketplaceCache = {
        MARKETPLACE_PAYMENT_LIST_TTL: 45,
        paymentListKey: (userId, query) =>
          `marketplace:payments:user:${userId}:${JSON.stringify(query)}`,
        getMarketplaceCache: async key => cached.get(key) || null,
        setMarketplaceCache: async (key, value, ttl) => {
          cached.set(key, value)
          ttls.set(key, ttl)
          return true
        },
        invalidateMarketplacePaymentCaches: async () => true
      }
      let findCalls = 0
      let countCalls = 0
      const controller = loadListController({
        marketplaceCache,
        find: () => {
          findCalls += 1
          return mockFindChain([])
        },
        countDocuments: async () => {
          countCalls += 1
          return 0
        }
      })
      const request = (id, page) => ({
        user: { id, userType: 'transporter' },
        query: { page: String(page), limit: '20' }
      })

      const first = createMockRes()
      const hit = createMockRes()
      const nextPage = createMockRes()
      const otherUser = createMockRes()
      await controller.listMarketplacePayments(request('transporter-1', 1), first, error => { throw error })
      await controller.listMarketplacePayments(request('transporter-1', 1), hit, error => { throw error })
      await controller.listMarketplacePayments(request('transporter-1', 2), nextPage, error => { throw error })
      await controller.listMarketplacePayments(request('transporter-2', 1), otherUser, error => { throw error })

      assert.deepEqual(hit.body, first.body)
      assert.equal(findCalls, 3)
      assert.equal(countCalls, 3)
      assert.ok([...ttls.values()].every(ttl => ttl === 45))
    }
  }
]

module.exports = marketplacePaymentListTests

if (require.main === module) {
  ;(async () => {
    let passed = 0
    let failed = 0
    for (const test of marketplacePaymentListTests) {
      try {
        await test.run()
        console.log(`PASS ${test.name}`)
        passed++
      } catch (err) {
        console.error(`FAIL ${test.name}`)
        console.error(err)
        failed++
      }
    }
    console.log(`\n${passed}/${passed + failed} tests passed`)
    if (failed > 0) process.exit(1)
  })()
}
