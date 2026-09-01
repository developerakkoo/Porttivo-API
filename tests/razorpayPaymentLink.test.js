const assert = require('node:assert/strict')
const path = require('node:path')

const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const buildController = (overrides = {}) =>
  loadWithMocks(
    path.resolve(
      process.cwd(),
      'src/controllers/razorpayPaymentLink.controller.js'
    ),
    {
      '../models/Transporter':
        overrides.Transporter || {
          findById: async () => null
        },
      '../models/PaymentSession':
        overrides.PaymentSession || {
          create: async payload => ({
            ...payload,
            _id: 'payment-session-1',
            publicId: 'pay_session_1',
            save: async function save() {
              return this
            }
          }),
          findById: async () => null,
          deleteOne: async () => ({ deletedCount: 0 })
        },
      '../models/RazorpayPaymentLink':
        overrides.RazorpayPaymentLink || {
          create: async () => null,
          findOne: async () => null
        },
      '../services/razorpayRoute.service':
        overrides.razorpayRouteService || {
          createPaymentLink: async () => null,
          fetchPaymentLink: async () => null,
          cancelPaymentLink: async () => null,
          makeReferenceId: () => 'PTV-test-ref'
        },
      '../services/razorpayPayout.service':
        overrides.razorpayPayoutService || {
          createAutomaticPayoutForPayment: async () => null
        },
      '../utils/logger': {
        info: () => {},
        warn: () => {},
        error: () => {}
      }
    }
  )

module.exports = [
  {
    name: 'createTransporterPaymentLink uses payer details and callback URL',
    async run() {
      const createdRecords = []
      let capturedPayload = null

      const controller = buildController({
        Transporter: {
          findById: async id => {
            if (id === 'actor-1') {
              return {
                _id: 'actor-1',
                name: 'Porttivo Seller',
                company: 'Porttivo Seller Pvt Ltd',
                mobile: '9000000001',
                email: 'seller@example.com',
                razorpayRouteAccountId: 'route_acc_1'
              }
            }

            if (id === 'payer-1') {
              return {
                _id: 'payer-1',
                name: 'Porttivo Buyer',
                company: 'Porttivo Buyer Pvt Ltd',
                mobile: '9000000002',
                email: 'buyer@example.com'
              }
            }

            return null
          }
        },
        RazorpayPaymentLink: {
          create: async payload => {
            createdRecords.push(payload)
            return {
              ...payload,
              _id: 'payment-link-1',
              save: async function save() {
                return this
              }
            }
          }
        },
        razorpayRouteService: {
          createPaymentLink: async payload => {
            capturedPayload = payload
            return {
              id: 'plink_1',
              short_url: 'https://rzp.io/i/plink_1'
            }
          },
          fetchPaymentLink: async () => null,
          cancelPaymentLink: async () => null,
          makeReferenceId: () => 'PTV-REF-001'
        }
      })

      const req = {
        user: { id: 'actor-1', userType: 'transporter' },
        body: {
          amount: 1250,
          description: 'Trip advance payment',
          payerTransporterId: 'payer-1',
          referenceType: 'TRIP',
          referenceId: 'TRIP-1001',
          callbackUrl: 'https://app.example/razorpay/callback'
        }
      }
      const res = createMockRes()

      await controller.createTransporterPaymentLink(req, res, error => {
        throw error
      })

      assert.equal(res.statusCode, 201)
      assert.equal(res.body.data.paymentLinkId, 'plink_1')
      assert.equal(res.body.data.callbackUrl, 'https://app.example/razorpay/callback')
      assert.equal(res.body.data.payerTransporterId, 'payer-1')
      assert.equal(res.body.data.beneficiaryTransporterId, 'actor-1')
      assert.equal(createdRecords[0].payerTransporterId, 'payer-1')
      assert.equal(createdRecords[0].beneficiaryTransporterId, 'actor-1')
      assert.equal(createdRecords[0].businessReferenceType, 'TRIP')
      assert.equal(createdRecords[0].businessReferenceId, 'TRIP-1001')
      assert.equal(createdRecords[0].callbackUrl, 'https://app.example/razorpay/callback')
      assert.equal(capturedPayload.customer.name, 'Porttivo Buyer')
      assert.equal(capturedPayload.customer.email, 'buyer@example.com')
      assert.equal(capturedPayload.customer.contact, '9000000002')
      assert.equal(capturedPayload.notes.payerTransporterId, 'payer-1')
      assert.equal(capturedPayload.notes.beneficiaryTransporterId, 'actor-1')
      assert.equal(capturedPayload.notes.referenceType, 'TRIP')
      assert.equal(capturedPayload.notes.referenceId, 'TRIP-1001')
      assert.equal(capturedPayload.notes.paymentSessionId, 'payment-session-1')
      assert.equal(capturedPayload.notes.payout.payeeId, 'actor-1')
      assert.equal(capturedPayload.callbackUrl, 'https://app.example/razorpay/callback')
      assert.equal(createdRecords[0].paymentSessionId.toString(), 'payment-session-1')
      assert.equal(createdRecords[0].metadata.payout.payeeId, 'actor-1')
      assert.equal(res.body.data.paymentSessionId.toString(), 'payment-session-1')
    }
  },
  {
    name: 'GET webhook refreshes local record from Razorpay provider data',
    async run() {
      const record = {
        _id: 'record-1',
        razorpayPaymentLinkId: 'plink_1',
        payerTransporterId: 'actor-1',
        status: 'CREATED',
        transferStatus: 'NOT_STARTED',
        paymentResponse: {},
        webhookPayload: {},
        save: async function save() {
          return this
        }
      }

      const controller = buildController({
        RazorpayPaymentLink: {
          findOne: async query => {
            if (query?.razorpayPaymentLinkId === 'plink_1') {
              return record
            }

            return null
          }
        },
        razorpayRouteService: {
          createPaymentLink: async () => null,
          fetchPaymentLink: async () => ({
            id: 'plink_1',
            status: 'paid',
            payments: [
              {
                id: 'pay_1',
                created_at: 1700000000
              }
            ]
          }),
          cancelPaymentLink: async () => null,
          makeReferenceId: () => 'PTV-REF-002'
        }
      })

      const req = {
        method: 'GET',
        query: {
          payment_link_id: 'plink_1'
        },
        body: {},
        headers: {},
        rawBody: ''
      }
      const res = createMockRes()

      await controller.handleRazorpayPaymentLinkWebhook(req, res, error => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(record.status, 'PAID')
      assert.equal(record.razorpayPaymentId, 'pay_1')
      assert.equal(record.paymentResponse.id, 'plink_1')
      assert.equal(record.webhookPayload.method, 'GET')
      assert.equal(record.webhookPayload.signaturePresent, false)
    }
  },
  {
    name: 'payment_link.paid webhook marks the payment session success and creates payout once',
    async run() {
      const payoutCalls = []
      const paymentSessionId = '64f1c2b3a4d5e6f708091011'
      const paymentSessionDoc = {
        _id: paymentSessionId,
        publicId: 'pay_session_1',
        status: 'CREATED',
        amount: 1250,
        currency: 'INR',
        referenceType: 'TRIP',
        referenceId: 'TRIP-1001',
        provider: 'RAZORPAY',
        metadata: {
          payout: {
            payeeId: 'actor-1',
            payeeType: 'TRANSPORTER',
            transferMode: 'IMPS',
            paymentSessionId
          }
        },
        paymentResponse: {},
        callbackPayload: null,
        save: async function save() {
          return this
        }
      }

      const record = {
        _id: 'record-1',
        razorpayPaymentLinkId: 'plink_1',
        payerTransporterId: 'payer-1',
        beneficiaryTransporterId: 'actor-1',
        paymentSessionId,
        status: 'CREATED',
        transferStatus: 'NOT_STARTED',
        metadata: {
          payout: {
            payeeId: 'actor-1',
            paymentSessionId,
            paymentLinkId: 'plink_1'
          }
        },
        paymentResponse: {},
        webhookPayload: {},
        save: async function save() {
          return this
        }
      }

      const controller = buildController({
        PaymentSession: {
          create: async () => paymentSessionDoc,
          findById: async id => (id === paymentSessionId ? paymentSessionDoc : null),
          deleteOne: async () => ({ deletedCount: 0 })
        },
        RazorpayPaymentLink: {
          create: async () => record,
          findOne: async query => {
            if (query?.razorpayPaymentLinkId === 'plink_1') {
              return record
            }

            return null
          }
        },
        razorpayPayoutService: {
          createAutomaticPayoutForPayment: async paymentInput => {
            payoutCalls.push(paymentInput)
            return {
              _id: 'payout-1',
              provider: 'RAZORPAY',
              status: 'SUCCESS',
              razorpay: {
                payoutId: 'pout_1',
                referenceId: 'ref_1'
              }
            }
          }
        }
      })

      const body = {
        event: 'payment_link.paid',
        payload: {
          payment: {
            entity: {
              id: 'pay_1',
              notes: {
                paymentLinkId: 'plink_1',
                paymentSessionId
              }
            }
          }
        }
      }

      const req = {
        method: 'POST',
        body,
        headers: {},
        rawBody: JSON.stringify(body),
        query: {}
      }
      const res = createMockRes()

      await controller.handleRazorpayPaymentLinkWebhook(req, res, error => {
        throw error
      })

      await controller.handleRazorpayPaymentLinkWebhook(req, res, error => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(paymentSessionDoc.status, 'SUCCESS')
      assert.equal(paymentSessionDoc.providerTransactionId, 'pay_1')
      assert.equal(record.status, 'PAID')
      assert.equal(record.razorpayPaymentId, 'pay_1')
      assert.equal(record.metadata.payout.id, 'payout-1')
      assert.equal(paymentSessionDoc.metadata.payout.id, 'payout-1')
      assert.equal(payoutCalls.length, 1)
    }
  },
  {
    name: 'POST webhook rejects malformed Razorpay signatures safely',
    async run() {
      const previousSecret = process.env.RAZORPAY_WEBHOOK_SECRET
      process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_secret'

      try {
        const controller = buildController({
          RazorpayPaymentLink: {
            findOne: async () => null
          }
        })

        const body = {
          event: 'payment_link.paid',
          payload: {
            payment: {
              entity: {
                id: 'pay_1',
                notes: {
                  paymentLinkId: 'plink_1'
                }
              }
            }
          }
        }

        const req = {
          method: 'POST',
          body,
          headers: {
            'x-razorpay-signature': 'abc'
          },
          rawBody: JSON.stringify(body),
          query: {}
        }
        const res = createMockRes()

        await controller.handleRazorpayPaymentLinkWebhook(req, res, error => {
          throw error
        })

        assert.equal(res.statusCode, 400)
        assert.equal(res.body.message, 'Invalid Razorpay webhook signature')
      } finally {
        process.env.RAZORPAY_WEBHOOK_SECRET = previousSecret
      }
    }
  }
]
