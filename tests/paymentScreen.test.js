const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const mongoose = require('mongoose')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const makeSession = () => ({
  startTransaction: () => {},
  commitTransaction: async () => {},
  abortTransaction: async () => {},
  endSession: () => {}
})

const buildPayuWebhookHash = ({
  salt,
  status,
  udf1 = '',
  udf2 = '',
  udf3 = '',
  udf4 = '',
  udf5 = '',
  email,
  firstname,
  productinfo,
  amount,
  txnid,
  key
}) =>
  crypto
    .createHash('sha512')
    .update([
      salt,
      status,
      '',
      '',
      '',
      '',
      '',
      udf5,
      udf4,
      udf3,
      udf2,
      udf1,
      email,
      firstname,
      productinfo,
      amount,
      txnid,
      key
    ].join('|'))
    .digest('hex')

const paymentTests = [
  {
    name: 'payment gateway options expose PayU and Cashfree',
    run() {
      const service = require('../src/services/paymentGateway.service')
      const providers = service.getAvailableGatewayOptions().map((gateway) => gateway.provider)
      assert.deepEqual(providers, ['PAYU', 'CASHFREE'])
    }
  },
  {
    name: 'initiatePaymentSession creates a PayU checkout request',
    async run() {
      const paymentDoc = {
        _id: 'payment-1',
        status: 'CREATED',
        provider: 'PAYU',
        referenceType: 'INVOICE',
        referenceId: 'INV-1001',
        purpose: 'Invoice payment',
        amount: 1250,
        currency: 'INR',
        merchantTransactionId: 'PAYU-ABC',
        payer: {
          userId: 'payer-1',
          userType: 'transporter',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          mobile: '9999999999'
        },
        metadata: {},
        save: async function save() {
          return this
        }
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          mongoose: {
            ...mongoose,
            startSession: async () => makeSession()
          },
          '../models/PaymentSession': {
            findOne: () => ({
              sort: async () => null
            }),
            create: async ([doc]) => {
              Object.assign(paymentDoc, doc)
              return [paymentDoc]
            }
          }
        }
      )

      const req = {
        user: {
          id: 'payer-1',
          userType: 'transporter',
          userData: {
            name: 'Alpha Logistics',
            email: 'alpha@example.com',
            mobile: '9999999999'
          }
        },
        body: {
          provider: 'PAYU',
          amount: 1250,
          currency: 'INR',
          purpose: 'Invoice payment',
          referenceType: 'INVOICE',
          referenceId: 'INV-1001'
        }
      }
      const res = createMockRes()

      await controller.initiatePaymentSession(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.data.payment.provider, 'PAYU')
      assert.equal(res.body.data.payment.status, 'PENDING')
      assert.equal(res.body.data.payment.paymentRequest.method, 'POST')
      assert.equal(res.body.data.payment.paymentRequest.fields.txnid.startsWith('PAYU-'), true)
      assert.ok(res.body.data.payment.paymentRequest.fields.hash)
    }
  },
  {
    name: 'initiatePaymentSession creates a Cashfree checkout request with explicit session ids',
    async run() {
      const paymentDoc = {
        _id: 'payment-cf-1',
        status: 'CREATED',
        provider: 'CASHFREE',
        referenceType: 'INVOICE',
        referenceId: 'INV-2001',
        purpose: 'Invoice payment',
        amount: 1500,
        currency: 'INR',
        merchantTransactionId: 'CF-ABC',
        payer: {
          userId: 'payer-1',
          userType: 'transporter',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          mobile: '9999999999'
        },
        metadata: {},
        save: async function save() {
          return this
        }
      }

      const originalFetch = global.fetch
      global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            order_id: 'CF-ORDER-2',
            payment_session_id: 'CF-SESSION-2',
            payment_link: 'https://cashfree.example/checkout/CF-ORDER-2'
          })
      })

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          mongoose: {
            ...mongoose,
            startSession: async () => makeSession()
          },
          '../models/PaymentSession': {
            findOne: () => ({
              sort: async () => null
            }),
            create: async ([doc]) => {
              Object.assign(paymentDoc, doc)
              return [paymentDoc]
            }
          }
        }
      )

      const req = {
        user: {
          id: 'payer-1',
          userType: 'transporter',
          userData: {
            name: 'Alpha Logistics',
            email: 'alpha@example.com',
            mobile: '9999999999'
          }
        },
        body: {
          provider: 'CASHFREE',
          amount: 1500,
          currency: 'INR',
          purpose: 'Invoice payment',
          referenceType: 'INVOICE',
          referenceId: 'INV-2001'
        }
      }
      const res = createMockRes()

      try {
        await controller.initiatePaymentSession(req, res, (error) => {
          throw error
        })

        assert.equal(res.statusCode, 200)
        assert.equal(res.body.data.payment.provider, 'CASHFREE')
        assert.equal(res.body.data.payment.cashfree.order_id, 'CF-ORDER-2')
        assert.equal(res.body.data.payment.cashfree.payment_session_id, 'CF-SESSION-2')
        assert.equal(res.body.data.payment.paymentRequest.fields.payment_session_id, 'CF-SESSION-2')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'buildPaymentInitiationRequest creates a Cashfree order payload',
    async run() {
      const originalFetch = global.fetch
      global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            order_id: 'CF-ORDER-1',
            payment_session_id: 'CF-SESSION-1',
            payment_link: 'https://cashfree.example/checkout/CF-ORDER-1'
          })
      })

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/paymentGateway.service.js'),
        {
          '../config/env': {
            payuMode: 'sandbox',
            payuKey: 'test-key',
            payuSalt: 'test-salt',
            payuCheckoutUrl: 'https://payu.example/checkout',
            payuWebhookUrl: 'https://payu.example/webhook',
            cashfreeMode: 'sandbox',
            cashfreeClientId: 'cf-client',
            cashfreeClientSecret: 'cf-secret',
            cashfreeWebhookSecret: 'cf-secret',
            cashfreeApiVersion: '2023-08-01',
            cashfreeApiBaseUrl: 'https://sandbox.cashfree.com/pg',
            cashfreeCheckoutUrl: 'https://sandbox.cashfree.com/checkout',
            cashfreeReturnUrl: 'https://app.example/success',
            cashfreeWebhookUrl: 'https://app.example/webhook'
          }
        }
      )

      try {
        const request = await service.buildPaymentInitiationRequest({
          provider: 'CASHFREE',
          merchantTransactionId: 'CF-ABC',
          amount: 1500,
          payer: {
            userId: 'payer-1',
            name: 'Alpha Logistics',
            email: 'alpha@example.com',
            mobile: '9999999999'
          },
          reference: {
            referenceType: 'INVOICE',
            referenceId: 'INV-1001',
            purpose: 'Invoice payment'
          }
        })

        assert.equal(request.provider, 'CASHFREE')
        assert.equal(request.fields.order_id, 'CF-ORDER-1')
        assert.equal(request.fields.payment_session_id, 'CF-SESSION-1')
        assert.equal(request.actionUrl, 'https://cashfree.example/checkout/CF-ORDER-1')
        assert.equal(request.fields.order_meta.notify_url, 'https://app.example/webhook')
        assert.deepEqual(request.fields.payment_session_id, 'CF-SESSION-1')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'PayU webhook marks the payment as successful',
    async run() {
      const paymentDoc = {
        _id: '507f1f77bcf86cd799439011',
        provider: 'PAYU',
        status: 'PENDING',
        merchantTransactionId: 'PAYU-ABC',
        payer: {
          userId: 'payer-1',
          userType: 'transporter',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          mobile: '9999999999'
        },
        paymentResponse: {},
        callbackPayload: {},
        save: async function save() {
          return this
        }
      }

      const hash = buildPayuWebhookHash({
        salt: 'Hu0hwsqnioAkcUzuvvS0CuDoqPZB1HPm',
        status: 'success',
        udf1: '507f1f77bcf86cd799439011',
        email: 'alpha@example.com',
        firstname: 'Alpha Logistics',
        productinfo: 'Invoice payment',
        amount: '1250.00',
        txnid: 'PAYU-ABC',
        key: 'twIHLx'
      })

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          '../services/paymentGateway.service.js': {
            buildPaymentInitiationRequest: async () => ({}),
            getAvailableGatewayOptions: () => [],
            getGatewayPayloadMetadata: () => ({
              provider: 'PAYU',
              status: 'SUCCESS',
              providerTransactionId: 'mih-1',
              providerOrderId: 'ord-1'
            }),
            getProviderConfig: () => ({
              provider: 'PAYU',
              displayName: 'PayU',
              configured: true,
              mode: 'sandbox'
            }),
            makeTransactionId: () => 'PAYU-TEST',
            normalizeMoney: (value) => Number(value).toFixed(2),
            normalizeProvider: (value) => String(value).toUpperCase(),
            resolvePayerProfile: () => ({
              userId: 'payer-1',
              userType: 'transporter',
              name: 'Alpha Logistics',
              email: 'alpha@example.com',
              mobile: '9999999999'
            }),
            verifyGatewayWebhook: () => true,
          },
          '../models/PaymentSession': {
            findById: async () => paymentDoc,
            findOne: () => ({
              sort: async () => null
            })
          }
        }
      )

      const req = {
        params: { provider: 'PAYU' },
        query: {},
        body: {
          txnid: 'PAYU-ABC',
          amount: '1250.00',
          productinfo: 'Invoice payment',
          firstname: 'Alpha Logistics',
          email: 'alpha@example.com',
          status: 'success',
          udf1: '507f1f77bcf86cd799439011',
          hash
        },
        headers: {},
        rawBody: JSON.stringify({
          txnid: 'PAYU-ABC',
          amount: '1250.00',
          productinfo: 'Invoice payment',
          firstname: 'Alpha Logistics',
          email: 'alpha@example.com',
          status: 'success',
          udf1: '507f1f77bcf86cd799439011',
          hash
        })
      }
      const res = createMockRes()

      await controller.handleGatewayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(paymentDoc.status, 'SUCCESS')
      assert.ok(paymentDoc.completedAt instanceof Date)
    }
  },
  {
    name: 'Cashfree webhook marks the payment as successful',
    async run() {
      const originalFetch = global.fetch
      global.fetch = originalFetch

      const paymentDoc = {
        _id: '507f1f77bcf86cd799439012',
        provider: 'CASHFREE',
        status: 'PENDING',
        merchantTransactionId: 'CF-ABC',
        payer: {
          userId: 'payer-1',
          userType: 'transporter',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          mobile: '9999999999'
        },
        paymentResponse: {},
        callbackPayload: {},
        save: async function save() {
          return this
        }
      }

      const bodyObject = {
        cf_order_id: 'CF-ABC',
        cf_payment_id: 'CF-PAY-1',
        order_status: 'PAID',
        payment_session_id: '507f1f77bcf86cd799439012'
      }
      const rawBody = JSON.stringify(bodyObject)
      const signature = crypto
        .createHmac('sha256', 'cf-secret')
        .update(rawBody)
        .digest('base64')

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          '../config/env': {
            payuMode: 'sandbox',
            payuKey: 'test-key',
            payuSalt: 'test-salt',
            payuCheckoutUrl: 'https://payu.example/checkout',
            payuWebhookUrl: 'https://payu.example/webhook',
            cashfreeMode: 'sandbox',
            cashfreeClientId: 'cf-client',
            cashfreeClientSecret: 'cf-secret',
            cashfreeWebhookSecret: 'cf-secret',
            cashfreeApiVersion: '2023-08-01',
            cashfreeApiBaseUrl: 'https://sandbox.cashfree.com/pg',
            cashfreeCheckoutUrl: 'https://sandbox.cashfree.com/checkout',
            cashfreeReturnUrl: 'https://app.example/success',
            cashfreeWebhookUrl: 'https://app.example/webhook'
          },
          '../models/PaymentSession': {
            findById: async () => paymentDoc,
            findOne: () => ({
              sort: async () => null
            })
          }
        }
      )

      const req = {
        params: { provider: 'CASHFREE' },
        query: {},
        body: bodyObject,
        headers: {
          'x-webhook-signature': signature
        },
        rawBody
      }
      const res = createMockRes()

      await controller.handleGatewayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(paymentDoc.status, 'SUCCESS')
      assert.equal(paymentDoc.providerTransactionId, 'CF-PAY-1')
      assert.ok(paymentDoc.completedAt instanceof Date)
    }
  },
  {
    name: 'Cashfree return GET is acknowledged without failing the payment',
    async run() {
      const paymentDoc = {
        _id: '507f1f77bcf86cd799439013',
        provider: 'CASHFREE',
        status: 'PENDING',
        merchantTransactionId: 'CF-RETURN-1',
        payer: {
          userId: 'payer-1',
          userType: 'transporter',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          mobile: '9999999999'
        },
        paymentResponse: {},
        callbackPayload: {},
        save: async function save() {
          return this
        }
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          '../models/PaymentSession': {
            findById: async () => paymentDoc,
            findOne: () => ({
              sort: async () => null
            })
          }
        }
      )

      const req = {
        method: 'GET',
        query: {
          cf_order_id: 'CF-RETURN-1',
          order_status: 'PAID'
        },
        body: {},
        headers: {},
        rawBody: ''
      }
      const res = createMockRes()

      await controller.handleCashfreeReturn(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(paymentDoc.status, 'PENDING')
      assert.equal(paymentDoc.failureReason, undefined)
    }
  }
]

module.exports = paymentTests
