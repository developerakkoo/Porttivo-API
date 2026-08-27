const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const marketplacePaymentBeneficiaryTests = [
  {
    name: 'isPayeePayoutReady returns false when payee record is not found',
    async run() {
      const { isPayeePayoutReady } = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../models/Transporter': { findById: async () => null },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null }
        }
      )

      const result = await isPayeePayoutReady('507f1f77bcf86cd799439011')
      assert.equal(result.ready, false)
      assert.equal(result.reason, 'PAYEE_NOT_FOUND')
    }
  },
  {
    name: 'isPayeePayoutReady returns false when payee has no razorpayBeneficiary or inactive status',
    async run() {
      const mockTransporterWithoutBene = {
        _id: '507f1f77bcf86cd799439011',
        name: 'Transporter Without Bene',
        razorpayBeneficiary: null
      }

      const mockTransporterInactive = {
        _id: '507f1f77bcf86cd799439012',
        name: 'Transporter Inactive',
        razorpayBeneficiary: {
          contactId: 'cont_123',
          fundAccountId: 'fa_123',
          status: 'PENDING'
        }
      }

      const { isPayeePayoutReady } = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../models/Transporter': {
            findById: async (id) => {
              if (id === '507f1f77bcf86cd799439011') return mockTransporterWithoutBene
              if (id === '507f1f77bcf86cd799439012') return mockTransporterInactive
              return null
            }
          },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null }
        }
      )

      const res1 = await isPayeePayoutReady('507f1f77bcf86cd799439011')
      assert.equal(res1.ready, false)
      assert.equal(res1.reason, 'RAZORPAY_BENEFICIARY_NOT_READY')

      const res2 = await isPayeePayoutReady('507f1f77bcf86cd799439012')
      assert.equal(res2.ready, false)
      assert.equal(res2.reason, 'RAZORPAY_BENEFICIARY_NOT_READY')
    }
  },
  {
    name: 'isPayeePayoutReady returns true when payee has active Razorpay beneficiary details',
    async run() {
      const mockTransporterActive = {
        _id: '507f1f77bcf86cd799439013',
        name: 'Transporter Active',
        razorpayBeneficiary: {
          contactId: 'cont_active_123',
          fundAccountId: 'fa_active_123',
          status: 'ACTIVE'
        }
      }

      const { isPayeePayoutReady } = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../models/Transporter': {
            findById: async (id) => {
              if (id === '507f1f77bcf86cd799439013') return mockTransporterActive
              return null
            }
          },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null }
        }
      )

      const res = await isPayeePayoutReady('507f1f77bcf86cd799439013')
      assert.equal(res.ready, true)
      assert.equal(res.contactId, 'cont_active_123')
      assert.equal(res.fundAccountId, 'fa_active_123')
    }
  },
  {
    name: 'marketplace payment initiation is blocked with 400 when recipient transporter has no beneficiary',
    async run() {
      const mockTrip = {
        _id: 'trip-1',
        tripId: 'TRIP-101',
        status: 'ACTIVE',
        isFromBooking: true,
        bookingId: 'booking-1',
        milestones: [{ milestoneNumber: 1 }]
      }

      const mockBooking = {
        _id: 'booking-1',
        status: 'CONFIRMED',
        agreedPrice: 12000,
        buyerId: 'transporter-buyer',
        sellerId: 'transporter-seller-no-bene'
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/marketplacePayment.controller.js'),
        {
          '../models/Trip': {
            findById: () => ({
              populate: () => ({
                populate: () => ({
                  populate: async () => mockTrip
                })
              })
            })
          },
          '../models/VehicleBooking': {
            findById: () => ({
              populate: () => ({
                populate: async () => mockBooking
              })
            })
          },
          '../models/MarketplacePayment': {
            findOne: () => ({
              sort: () => ({
                lean: async () => null
              })
            })
          },
          '../services/razorpayPayout.service': {
            isPayeePayoutReady: async (payeeId) => {
              assert.equal(payeeId, 'transporter-seller-no-bene')
              return {
                ready: false,
                reason: 'RAZORPAY_BENEFICIARY_NOT_READY',
                message: "Payee's Razorpay beneficiary details have not been added or are not active"
              }
            }
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'transporter-buyer'
          }
        }
      )

      const req = {
        params: { tripId: 'trip-1' },
        user: { id: 'transporter-buyer', userType: 'transporter' },
        body: {}
      }
      const res = createMockRes()

      await controller.initiateMarketplaceTripRazorpayPayment(req, res, (err) => {
        throw err
      })

      assert.equal(res.statusCode, 400)
      assert.equal(res.body.success, false)
      assert.match(res.body.message, /recipient transporter's Razorpay beneficiary details/i)
      assert.equal(res.body.reason, 'RAZORPAY_BENEFICIARY_NOT_READY')
    }
  },
  {
    name: 'createMarketplacePaymentRequestForTrip throws when recipient beneficiary is missing',
    async run() {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/marketplacePayment.service.js'),
        {
          '../services/razorpayPayout.service': {
            isPayeePayoutReady: async () => ({
              ready: false,
              reason: 'RAZORPAY_BENEFICIARY_NOT_READY'
            })
          },
          '../models/MarketplacePayment': {
            findOne: () => ({
              sort: async () => null
            })
          }
        }
      )

      const trip = { _id: 'trip-1', status: 'ACTIVE', isFromBooking: true }
      const booking = {
        _id: 'booking-1',
        agreedPrice: 5000,
        buyerId: { _id: 'buyer-1', email: 'buyer@test.com' },
        sellerId: 'seller-1'
      }

      await assert.rejects(
        () => service.createMarketplacePaymentRequestForTrip({ trip, booking }),
        /recipient transporter's Razorpay beneficiary details have not been added/i
      )
    }
  },
  {
    name: 'getMarketplaceTripPaymentStatus reports canInitiatePayment=false when recipient beneficiary is missing',
    async run() {
      const mockTrip = {
        _id: 'trip-1',
        tripId: 'TRIP-101',
        status: 'ACTIVE',
        isFromBooking: true,
        bookingId: 'booking-1',
        milestones: [{ milestoneNumber: 1 }]
      }

      const mockBooking = {
        _id: 'booking-1',
        status: 'CONFIRMED',
        agreedPrice: 15000,
        buyerId: 'buyer-1',
        sellerId: 'seller-no-bene',
        paymentStatus: 'PENDING'
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/marketplacePayment.controller.js'),
        {
          '../models/Trip': {
            findById: () => ({
              populate: () => ({
                populate: () => ({
                  populate: async () => mockTrip
                })
              })
            })
          },
          '../models/VehicleBooking': {
            findById: () => ({
              populate: () => ({
                populate: async () => mockBooking
              })
            })
          },
          '../models/MarketplacePayment': {
            findOne: () => ({
              sort: () => ({
                lean: async () => null
              })
            })
          },
          '../models/Payout': {
            findOne: () => ({
              sort: () => ({
                lean: async () => null
              })
            })
          },
          '../services/razorpayPayout.service': {
            isPayeePayoutReady: async () => ({
              ready: false,
              reason: 'RAZORPAY_BENEFICIARY_NOT_READY'
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'buyer-1'
          }
        }
      )

      const req = {
        params: { tripId: 'trip-1' },
        user: { id: 'buyer-1', userType: 'transporter' }
      }
      const res = createMockRes()

      await controller.getMarketplaceTripPaymentStatus(req, res, (err) => {
        throw err
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.data.eligibility.canInitiatePayment, false)
      assert.equal(res.body.data.eligibility.recipientBeneficiaryReady, false)
      assert.equal(res.body.data.eligibility.recipientBeneficiaryReason, 'RAZORPAY_BENEFICIARY_NOT_READY')
    }
  },
  {
    name: 'getMarketplaceTripPaymentStatus reports canInitiatePayment=true when recipient beneficiary is active',
    async run() {
      const mockTrip = {
        _id: 'trip-1',
        tripId: 'TRIP-101',
        status: 'ACTIVE',
        isFromBooking: true,
        bookingId: 'booking-1',
        milestones: [{ milestoneNumber: 1 }]
      }

      const mockBooking = {
        _id: 'booking-1',
        status: 'CONFIRMED',
        agreedPrice: 15000,
        buyerId: 'buyer-1',
        sellerId: 'seller-active-bene',
        paymentStatus: 'PENDING'
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/marketplacePayment.controller.js'),
        {
          '../models/Trip': {
            findById: () => ({
              populate: () => ({
                populate: () => ({
                  populate: async () => mockTrip
                })
              })
            })
          },
          '../models/VehicleBooking': {
            findById: () => ({
              populate: () => ({
                populate: async () => mockBooking
              })
            })
          },
          '../models/MarketplacePayment': {
            findOne: () => ({
              sort: () => ({
                lean: async () => null
              })
            })
          },
          '../models/Payout': {
            findOne: () => ({
              sort: () => ({
                lean: async () => null
              })
            })
          },
          '../services/razorpayPayout.service': {
            isPayeePayoutReady: async () => ({
              ready: true,
              contactId: 'cont_1',
              fundAccountId: 'fa_1'
            })
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'buyer-1'
          }
        }
      )

      const req = {
        params: { tripId: 'trip-1' },
        user: { id: 'buyer-1', userType: 'transporter' }
      }
      const res = createMockRes()

      await controller.getMarketplaceTripPaymentStatus(req, res, (err) => {
        throw err
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.data.eligibility.canInitiatePayment, true)
      assert.equal(res.body.data.eligibility.recipientBeneficiaryReady, true)
    }
  },
  {
    name: 'initiateMarketplaceTripRazorpayPayment succeeds when recipient beneficiary is active',
    async run() {
      const mockTrip = {
        _id: 'trip-1',
        tripId: 'TRIP-101',
        status: 'ACTIVE',
        isFromBooking: true,
        bookingId: 'booking-1',
        milestones: [{ milestoneNumber: 1 }]
      }

      const mockBooking = {
        _id: 'booking-1',
        status: 'CONFIRMED',
        agreedPrice: 12000,
        buyerId: 'transporter-buyer',
        sellerId: 'transporter-seller-active'
      }

      const mockCreatedPayment = {
        _id: 'payment-1',
        tripId: 'trip-1',
        bookingId: 'booking-1',
        status: 'PENDING',
        amount: 12000,
        currency: 'INR',
        merchantTransactionId: 'TXN-123',
        paymentRequest: {
          actionUrl: 'https://api.razorpay.com/checkout',
          method: 'POST',
          mode: 'sandbox',
          fields: {
            order_id: 'order_RZP_123'
          }
        }
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/marketplacePayment.controller.js'),
        {
          '../models/Trip': {
            findById: () => ({
              populate: () => ({
                populate: () => ({
                  populate: async () => mockTrip
                })
              })
            })
          },
          '../models/VehicleBooking': {
            findById: () => ({
              populate: () => ({
                populate: async () => mockBooking
              })
            })
          },
          '../models/MarketplacePayment': {
            findOne: () => ({
              sort: () => ({
                lean: async () => null
              })
            })
          },
          '../services/razorpayPayout.service': {
            isPayeePayoutReady: async () => ({
              ready: true,
              contactId: 'cont_1',
              fundAccountId: 'fa_1'
            })
          },
          '../services/marketplacePayment.service': {
            createMarketplacePaymentRequestForTrip: async () => mockCreatedPayment
          },
          '../utils/transporterActor': {
            getTransporterActorId: () => 'transporter-buyer'
          }
        }
      )

      const req = {
        params: { tripId: 'trip-1' },
        user: { id: 'transporter-buyer', userType: 'transporter' },
        body: { payerName: 'Buyer Transporter', payerEmail: 'buyer@transporter.com' }
      }
      const res = createMockRes()

      await controller.initiateMarketplaceTripRazorpayPayment(req, res, (err) => {
        throw err
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.data.payment.amount, 12000)
      assert.equal(res.body.data.payment.providerOrderId, 'order_RZP_123')
    }
  }
]

module.exports = marketplacePaymentBeneficiaryTests

if (require.main === module) {
  ;(async () => {
    let passed = 0
    let failed = 0
    for (const test of marketplacePaymentBeneficiaryTests) {
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

