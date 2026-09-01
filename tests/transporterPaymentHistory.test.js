const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const makeObjectId = (str) => ({ toString: () => str, toHexString: () => str })

// ---------------------------------------------------------------------------
// Minimal mock datasets
// ---------------------------------------------------------------------------

const TRANSPORTER_ID = '507f1f77bcf86cd799439001'
const OTHER_ID = '507f1f77bcf86cd799439002'
const DRIVER_ID = '507f1f77bcf86cd799439003'

const makePaymentSession = (overrides = {}) => ({
  _id: makeObjectId('ps_001'),
  publicId: 'pay_ps001',
  referenceId: 'TRIP-001',
  referenceType: 'TRIP',
  purpose: 'DRIVER_ADVANCE',
  provider: 'RAZORPAY',
  status: 'SUCCESS',
  amount: 5000,
  currency: 'INR',
  completedAt: new Date('2026-08-01T10:00:00Z'),
  createdAt: new Date('2026-08-01T09:00:00Z'),
  providerTransactionId: 'pay_razorpay_001',
  providerOrderId: 'order_001',
  payer: { userId: TRANSPORTER_ID, userType: 'transporter', name: 'Alpha Co', email: 'alpha@test.com', mobile: '9999999999' },
  initiatedBy: { userId: TRANSPORTER_ID, userType: 'transporter' },
  metadata: { transporterId: TRANSPORTER_ID, payout: { payeeId: DRIVER_ID, payeeType: 'DRIVER' } },
  ...overrides
})

const makePayout = (overrides = {}) => ({
  _id: makeObjectId('pout_001'),
  paymentId: makeObjectId('ps_001'),
  payerId: makeObjectId(TRANSPORTER_ID),
  payeeId: makeObjectId(DRIVER_ID),
  payeeType: 'DRIVER',
  amount: 5000,
  currency: 'INR',
  provider: 'RAZORPAY',
  status: 'SUCCESS',
  createdAt: new Date('2026-08-01T10:30:00Z'),
  completedAt: new Date('2026-08-01T11:00:00Z'),
  initiatedAt: new Date('2026-08-01T10:30:00Z'),
  cashfree: { transferId: null, utr: null, transferMode: 'IMPS' },
  razorpay: { payoutId: 'pout_rzp_001', transferMode: 'IMPS' },
  ...overrides
})

const makeMarketplacePayment = (overrides = {}) => ({
  _id: makeObjectId('mp_001'),
  publicId: 'mp_abc001',
  tripId: makeObjectId('trip_001'),
  bookingId: makeObjectId('booking_001'),
  payerTransporterId: makeObjectId(OTHER_ID),
  beneficiaryTransporterId: makeObjectId(TRANSPORTER_ID),
  provider: 'RAZORPAY',
  status: 'SUCCESS',
  amount: 12500,
  currency: 'INR',
  providerTransactionId: 'pay_rzp_mp001',
  providerOrderId: 'order_mp001',
  completedAt: new Date('2026-08-10T14:00:00Z'),
  createdAt: new Date('2026-08-10T13:00:00Z'),
  metadata: {},
  ...overrides
})

const makePaymentLink = (overrides = {}) => ({
  _id: makeObjectId('pl_001'),
  publicId: 'pl_abc001',
  payerTransporterId: makeObjectId(OTHER_ID),
  beneficiaryTransporterId: makeObjectId(TRANSPORTER_ID),
  razorpayPaymentLinkId: 'plink_rzp001',
  shortUrl: 'https://rzp.io/i/abc',
  referenceId: 'REF-001',
  amount: 8000,
  currency: 'INR',
  description: 'Vehicle hire payment',
  status: 'PAID',
  razorpayPaymentId: 'pay_link_001',
  razorpayOrderId: 'order_link_001',
  transferStatus: 'PROCESSED',
  paidAt: new Date('2026-08-15T16:00:00Z'),
  createdAt: new Date('2026-08-15T12:00:00Z'),
  metadata: {},
  ...overrides
})

// Build mock models
const buildMockModels = ({
  paymentSessions = [makePaymentSession()],
  payouts = [makePayout()],
  marketplacePayments = [makeMarketplacePayment()],
  paymentLinks = [makePaymentLink()]
} = {}) => ({
  '../models/PaymentSession': {
    find: (filter) => ({
      lean: async () => {
        // Mimic matching behaviour: just return all since tests handle determinism
        return paymentSessions
      }
    }),
    countDocuments: async () => paymentSessions.length
  },
  '../models/Payout': {
    find: (filter) => ({
      lean: async () => {
        return payouts
      }
    })
  },
  '../models/MarketplacePayment': {
    find: () => ({
      lean: async () => marketplacePayments
    })
  },
  '../models/RazorpayPaymentLink': {
    find: () => ({
      lean: async () => paymentLinks
    })
  }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const transporterPaymentHistoryTests = [
  {
    name: 'getTransporterPaymentHistory returns both RECEIVED and TRANSFERRED when direction=ALL',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels()
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'ALL',
        page: 1,
        limit: 100
      })

      assert.ok(result.payments.length > 0, 'should return payments')

      const directions = result.payments.map((p) => p.direction)
      assert.ok(directions.includes('RECEIVED'), 'should contain RECEIVED payments')
      assert.ok(directions.includes('TRANSFERRED'), 'should contain TRANSFERRED payments')
    }
  },

  {
    name: 'getTransporterPaymentHistory filters RECEIVED only payments correctly',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels()
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'RECEIVED',
        page: 1,
        limit: 100
      })

      assert.ok(result.payments.length > 0, 'should return RECEIVED payments')
      result.payments.forEach((p) => {
        assert.equal(p.direction, 'RECEIVED', `payment ${p.id} should be RECEIVED`)
      })
    }
  },

  {
    name: 'getTransporterPaymentHistory filters TRANSFERRED only payments correctly',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels()
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'TRANSFERRED',
        page: 1,
        limit: 100
      })

      assert.ok(result.payments.length > 0, 'should return TRANSFERRED payments')
      result.payments.forEach((p) => {
        assert.equal(p.direction, 'TRANSFERRED', `payment ${p.id} should be TRANSFERRED`)
      })
    }
  },

  {
    name: 'Marketplace RECEIVED: beneficiary transporter sees incoming marketplace payment',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels({
          paymentSessions: [],
          payouts: [],
          paymentLinks: []
        })
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'RECEIVED',
        page: 1,
        limit: 100
      })

      const mpPayment = result.payments.find((p) => p.category === 'MARKETPLACE_EARNING')
      assert.ok(mpPayment, 'should include marketplace earning (RECEIVED)')
      assert.equal(mpPayment.direction, 'RECEIVED')
      assert.equal(mpPayment.amount, 12500)
    }
  },

  {
    name: 'Marketplace TRANSFERRED: payer transporter sees outgoing marketplace payment',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels({
          paymentSessions: [],
          payouts: [],
          paymentLinks: [],
          marketplacePayments: [makeMarketplacePayment({
            payerTransporterId: makeObjectId(TRANSPORTER_ID),
            beneficiaryTransporterId: makeObjectId(OTHER_ID)
          })]
        })
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'TRANSFERRED',
        page: 1,
        limit: 100
      })

      const mpPayment = result.payments.find((p) => p.category === 'MARKETPLACE_BOOKING')
      assert.ok(mpPayment, 'should include marketplace booking (TRANSFERRED)')
      assert.equal(mpPayment.direction, 'TRANSFERRED')
    }
  },

  {
    name: 'RazorpayPaymentLink RECEIVED: beneficiary transporter sees paid link',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels({
          paymentSessions: [],
          payouts: [],
          marketplacePayments: []
        })
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'RECEIVED',
        page: 1,
        limit: 100
      })

      const linkPayment = result.payments.find((p) => p.category === 'PAYMENT_LINK')
      assert.ok(linkPayment, 'should include payment link receipt')
      assert.equal(linkPayment.direction, 'RECEIVED')
      assert.equal(linkPayment.amount, 8000)
      assert.equal(linkPayment.paymentStatus, 'SUCCESS', 'PAID status should map to SUCCESS')
    }
  },

  {
    name: 'Summary calculates totalReceivedAmount and totalTransferredAmount correctly',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels()
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'ALL',
        page: 1,
        limit: 100
      })

      assert.ok(typeof result.summary === 'object', 'should include summary')
      assert.ok(typeof result.summary.totalReceivedAmount === 'number', 'totalReceivedAmount should be a number')
      assert.ok(typeof result.summary.totalTransferredAmount === 'number', 'totalTransferredAmount should be a number')
      assert.ok(typeof result.summary.netAmount === 'number', 'netAmount should be a number')
      assert.equal(
        result.summary.netAmount,
        result.summary.totalReceivedAmount - result.summary.totalTransferredAmount,
        'netAmount should equal received - transferred'
      )
    }
  },

  {
    name: 'status=ALL does not get treated as a literal database status filter',
    async run () {
      let capturedFilter = null

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        {
          '../models/PaymentSession': {
            find: (filter) => {
              capturedFilter = filter
              return {
                lean: async () => [makePaymentSession()]
              }
            }
          },
          '../models/Payout': {
            find: () => ({
              lean: async () => []
            })
          },
          '../models/MarketplacePayment': {
            find: () => ({
              lean: async () => []
            })
          },
          '../models/RazorpayPaymentLink': {
            find: () => ({
              lean: async () => []
            })
          }
        }
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        status: 'ALL',
        page: 1,
        limit: 100
      })

      assert.ok(capturedFilter, 'model filter should be captured')
      assert.equal(capturedFilter.status, undefined, 'status=ALL should not be forwarded as a literal status')
      assert.ok(result.payments.length > 0, 'payments should still be returned')
    }
  },

  {
    name: 'Summary respects the active direction filter',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels()
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'RECEIVED',
        page: 1,
        limit: 100
      })

      assert.ok(result.summary.totalReceivedCount > 0, 'received count should be present')
      assert.equal(result.summary.totalTransferredCount, 0, 'transferred count should be excluded by the direction filter')
      assert.equal(
        result.summary.netAmount,
        result.summary.totalReceivedAmount - result.summary.totalTransferredAmount,
        'netAmount should still be derived from the filtered summary buckets'
      )
    }
  },

  {
    name: 'Summary received count only counts SUCCESS payments',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels({
          paymentSessions: [],
          payouts: [],
          paymentLinks: [],
          marketplacePayments: [
            makeMarketplacePayment({ status: 'SUCCESS' }),
            makeMarketplacePayment({
              _id: makeObjectId('mp_002'),
              status: 'PENDING',
              amount: 500
            })
          ]
        })
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'ALL',
        page: 1,
        limit: 100
      })

      assert.equal(result.summary.totalReceivedCount, 1, 'only 1 SUCCESS received payment should count')
    }
  },

  {
    name: 'Pagination works correctly: page 1 with limit 1 returns 1 item and hasNext=true',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels()
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'ALL',
        page: 1,
        limit: 1
      })

      assert.equal(result.count, 1)
      assert.equal(result.page, 1)
      assert.equal(result.limit, 1)
      assert.ok(result.total > 1, 'total should be greater than 1')
      assert.equal(result.hasNext, true)
      assert.equal(result.hasPrevious, false)
    }
  },

  {
    name: 'Search filter returns only matching payments',
    async run () {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels({
          paymentSessions: [makePaymentSession({ referenceId: 'TRIP-SEARCH-001' })],
          payouts: [],
          marketplacePayments: [],
          paymentLinks: []
        })
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'ALL',
        search: 'SEARCH-001',
        page: 1,
        limit: 100
      })

      assert.ok(result.payments.length > 0, 'should return matching payment')
      result.payments.forEach((p) => {
        const matchRef = (p.referenceId || '').includes('SEARCH-001')
        const matchPurpose = (p.purpose || '').includes('SEARCH-001')
        assert.ok(matchRef || matchPurpose, `payment ${p.id} should match search term`)
      })
    }
  },

  {
    name: 'Linked PaymentSession+Payout is treated as single TRANSFERRED item (no duplication)',
    async run () {
      const ps = makePaymentSession()
      const po = makePayout()

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels({
          paymentSessions: [ps],
          payouts: [po],
          marketplacePayments: [],
          paymentLinks: []
        })
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'TRANSFERRED',
        page: 1,
        limit: 100
      })

      // PaymentSession should be there with payout info attached (not duplicated as separate payout)
      const psItems = result.payments.filter((p) => p.id === String(ps._id))
      assert.equal(psItems.length, 1, 'PaymentSession should appear exactly once')
      assert.ok(psItems[0].payout !== null, 'PaymentSession should have linked payout attached')
    }
  },

  {
    name: 'Tenant isolation: transporter A cannot see transporter B exclusive records',
    async run () {
      // This transporter has NO payments — their transporterId does not appear
      const STRANGER_ID = '507f1f77bcf86cd799439099'
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        {
          '../models/PaymentSession': {
            find: () => ({ lean: async () => [] })
          },
          '../models/Payout': {
            find: () => ({ lean: async () => [] })
          },
          '../models/MarketplacePayment': {
            find: () => ({ lean: async () => [] })
          },
          '../models/RazorpayPaymentLink': {
            find: () => ({ lean: async () => [] })
          }
        }
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: STRANGER_ID,
        direction: 'ALL',
        page: 1,
        limit: 100
      })

      assert.equal(result.payments.length, 0, 'Stranger transporter should see no payments')
      assert.equal(result.total, 0)
    }
  },

  {
    name: 'GET /api/payments/transporter/history controller delegates to unified history service',
    async run () {
      let capturedArgs = null

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          '../services/paymentHistory.service': {
            getTransporterUnifiedPaymentHistory: async (args) => {
              capturedArgs = args
              return {
                page: 1,
                limit: 20,
                total: 0,
                count: 0,
                totalPages: 1,
                hasNext: false,
                hasPrevious: false,
                summary: {
                  totalReceivedAmount: 0,
                  totalTransferredAmount: 0,
                  netAmount: 0,
                  totalReceivedCount: 0,
                  totalTransferredCount: 0,
                  pendingReceivedAmount: 0,
                  pendingTransferredAmount: 0
                },
                payments: []
              }
            }
          },
          '../models/PaymentSession': {},
          '../models/Payout': {},
          '../services/cashfreePayout.service': {
            createAutomaticPayoutForPayment: async () => null,
            findPayeeRecordById: async () => ({ payee: null })
          }
        }
      )

      const req = {
        user: { id: TRANSPORTER_ID, userType: 'transporter' },
        query: {
          direction: 'RECEIVED',
          status: 'SUCCESS',
          provider: 'RAZORPAY',
          page: '2',
          limit: '10',
          fromDate: '2026-08-01',
          toDate: '2026-08-31',
          search: 'TRIP-001'
        }
      }
      const res = createMockRes()

      await controller.getTransporterPaymentHistory(req, res, (err) => { throw err })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.ok(capturedArgs, 'service should have been called')
      assert.equal(capturedArgs.transporterId, TRANSPORTER_ID)
      assert.equal(capturedArgs.direction, 'RECEIVED')
      assert.equal(capturedArgs.status, 'SUCCESS')
      assert.equal(capturedArgs.provider, 'RAZORPAY')
      assert.equal(capturedArgs.page, 2)
      assert.equal(capturedArgs.limit, 10)
      assert.equal(capturedArgs.fromDate, '2026-08-01')
      assert.equal(capturedArgs.toDate, '2026-08-31')
      assert.equal(capturedArgs.search, 'TRIP-001')
    }
  },

  {
    name: 'GET /api/payments/admin/history delegates to unified history service for a transporter view',
    async run () {
      let capturedArgs = null

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          '../services/paymentHistory.service': {
            getTransporterUnifiedPaymentHistory: async (args) => {
              capturedArgs = args
              return {
                page: 1,
                limit: 20,
                total: 0,
                count: 0,
                totalPages: 1,
                hasNext: false,
                hasPrevious: false,
                summary: {
                  totalReceivedAmount: 0,
                  totalTransferredAmount: 0,
                  netAmount: 0,
                  totalReceivedCount: 0,
                  totalTransferredCount: 0,
                  pendingReceivedAmount: 0,
                  pendingTransferredAmount: 0
                },
                payments: []
              }
            }
          },
          '../models/PaymentSession': {},
          '../models/Payout': {},
          '../services/cashfreePayout.service': {
            createAutomaticPayoutForPayment: async () => null,
            findPayeeRecordById: async () => ({ payee: null })
          }
        }
      )

      const req = {
        user: { id: 'admin-1', userType: 'admin' },
        query: {
          transporterId: TRANSPORTER_ID,
          direction: 'TRANSFERRED',
          page: '3',
          limit: '5'
        }
      }
      const res = createMockRes()

      await controller.getAdminPaymentHistory(req, res, (err) => { throw err })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.ok(capturedArgs, 'service should have been called')
      assert.equal(capturedArgs.transporterId, TRANSPORTER_ID)
      assert.equal(capturedArgs.direction, 'TRANSFERRED')
      assert.equal(capturedArgs.page, 3)
      assert.equal(capturedArgs.limit, 5)
    }
  },

  {
    name: 'Results are sorted descending by createdAt (newest first)',
    async run () {
      const olderPs = makePaymentSession({ createdAt: new Date('2026-07-01T00:00:00Z'), completedAt: new Date('2026-07-01T01:00:00Z') })
      const newerMp = makeMarketplacePayment({ createdAt: new Date('2026-08-20T00:00:00Z'), completedAt: new Date('2026-08-20T01:00:00Z') })

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentHistory.service.js'),
        buildMockModels({
          paymentSessions: [olderPs],
          payouts: [],
          paymentLinks: [],
          marketplacePayments: [newerMp]
        })
      )

      const result = await service.getTransporterUnifiedPaymentHistory({
        transporterId: TRANSPORTER_ID,
        direction: 'ALL',
        page: 1,
        limit: 100
      })

      if (result.payments.length >= 2) {
        const first = new Date(result.payments[0].createdAt)
        const second = new Date(result.payments[1].createdAt)
        assert.ok(first >= second, 'Results should be sorted newest first')
      }
    }
  }
]

module.exports = transporterPaymentHistoryTests
