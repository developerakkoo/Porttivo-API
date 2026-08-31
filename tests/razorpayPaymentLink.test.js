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
      '../models/RazorpayPaymentLink':
        overrides.RazorpayPaymentLink || {
          create: async () => null,
          findOne: async () => null
        },
      '../services/razorpayRoute.service':
        overrides.razorpayRouteService || {
          createPaymentLinkWithTransfer: async () => null,
          fetchPaymentLink: async () => null,
          cancelPaymentLink: async () => null,
          makeReferenceId: () => 'PTV-test-ref'
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
          createPaymentLinkWithTransfer: async payload => {
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
      assert.equal(capturedPayload.callbackUrl, 'https://app.example/razorpay/callback')
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
          createPaymentLinkWithTransfer: async () => null,
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
