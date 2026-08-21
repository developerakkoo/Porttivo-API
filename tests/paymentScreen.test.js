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
      assert.deepEqual(providers, ['PAYU', 'CASHFREE', 'RAZORPAY'])
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
    name: 'buildPaymentInitiationRequest creates a Razorpay order payload',
    async run() {
      const originalFetch = global.fetch
      let capturedBody = null
      global.fetch = async (_url, options = {}) => {
        capturedBody = JSON.parse(options.body || '{}')
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: 'order_RZP_1',
              amount: 125000,
              currency: 'INR'
            })
        }
      }

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
            cashfreeWebhookUrl: 'https://app.example/webhook',
            razorpayMode: 'sandbox',
            razorpayKeyId: 'rzp_key_id',
            razorpayKeySecret: 'rzp_key_secret',
            razorpayWebhookSecret: 'rzp_webhook_secret',
            razorpayApiBaseUrl: 'https://api.razorpay.com/v1',
            razorpayCheckoutUrl: 'https://checkout.razorpay.com/v1/checkout.js',
            razorpayWebhookUrl: 'https://app.example/razorpay/webhook'
          }
        }
      )

      try {
        const request = await service.buildPaymentInitiationRequest({
          provider: 'RAZORPAY',
          merchantTransactionId: 'RZP-ABC',
          amount: 1250,
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

        assert.equal(request.provider, 'RAZORPAY')
        assert.equal(request.fields.order_id, 'order_RZP_1')
        assert.equal(request.fields.key, 'rzp_key_id')
        assert.equal(request.fields.amount, 125000)
        assert.equal(request.fields.callback_url, 'https://app.example/razorpay/webhook')
        assert.deepEqual(capturedBody, {
          amount: 125000,
          currency: 'INR',
          receipt: 'RZP-ABC',
          notes: {
            referenceType: 'INVOICE',
            referenceId: 'INV-1001',
            purpose: 'Invoice payment',
            paymentSessionId: '',
            payerId: 'payer-1'
          }
        })
        assert.ok(!Object.prototype.hasOwnProperty.call(capturedBody, 'checkout'))
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'initiatePaymentSession stores the Razorpay order id for webhook matching',
    async run() {
      const paymentDoc = {
        _id: 'payment-rzp-1',
        status: 'CREATED',
        provider: 'RAZORPAY',
        referenceType: 'INVOICE',
        referenceId: 'INV-3001',
        purpose: 'Invoice payment',
        amount: 1750,
        currency: 'INR',
        merchantTransactionId: 'RZP-ABC',
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
      global.fetch = async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}')
        assert.equal(body.receipt, 'RZP-ABC')
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: 'order_RZP_1',
              amount: 175000,
              currency: 'INR'
            })
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
          provider: 'RAZORPAY',
          amount: 1750,
          currency: 'INR',
          purpose: 'Invoice payment',
          referenceType: 'INVOICE',
          referenceId: 'INV-3001'
        }
      }
      const res = createMockRes()

      try {
        await controller.initiatePaymentSession(req, res, (error) => {
          throw error
        })

        assert.equal(res.statusCode, 200)
        assert.equal(paymentDoc.providerOrderId, 'order_RZP_1')
        assert.equal(res.body.data.payment.razorpay.order_id, 'order_RZP_1')
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
    name: 'Razorpay webhook marks the payment as successful',
    async run() {
      const paymentDoc = {
        _id: '507f1f77bcf86cd799439014',
        provider: 'RAZORPAY',
        providerOrderId: 'order_RZP_1',
        status: 'PENDING',
        merchantTransactionId: 'RZP-ABC',
        payer: {
          userId: 'payer-1',
          userType: 'transporter',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          mobile: '9999999999'
        },
        paymentResponse: {},
        callbackPayload: {},
        metadata: {},
        save: async function save() {
          return this
        }
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          '../services/paymentGateway.service.js': {
            buildPaymentInitiationRequest: async () => ({}),
            getAvailableGatewayOptions: () => [],
            getGatewayPayloadMetadata: () => ({
              provider: 'RAZORPAY',
              status: 'SUCCESS',
              providerTransactionId: 'pay_RZP_1',
              providerOrderId: 'order_RZP_1'
            }),
            getProviderConfig: () => ({
              provider: 'RAZORPAY',
              displayName: 'Razorpay',
              configured: true,
              mode: 'sandbox'
            }),
            makeTransactionId: () => 'RZP-TEST',
            normalizeMoney: (value) => Number(value).toFixed(2),
            normalizeProvider: (value) => String(value).toUpperCase(),
            resolvePayerProfile: () => ({
              userId: 'payer-1',
              userType: 'transporter',
              name: 'Alpha Logistics',
              email: 'alpha@example.com',
              mobile: '9999999999'
            }),
            verifyGatewayWebhook: () => true
          },
          '../services/cashfreePayout.service': {
            createAutomaticPayoutForPayment: async () => ({
              _id: 'payout-1',
              status: 'PROCESSING',
              razorpay: {
                payoutId: 'pout_1'
              }
            })
          },
          '../models/PaymentSession': {
            findById: async () => null,
            findOne: async (query) => {
              if (query?.providerOrderId === 'order_RZP_1') {
                return paymentDoc
              }
              return null
            }
          }
        }
      )

      const body = {
        razorpay_order_id: 'order_RZP_1',
        razorpay_payment_id: 'pay_RZP_1',
        razorpay_signature: 'ignored',
        status: 'captured'
      }
      const req = {
        params: { provider: 'RAZORPAY' },
        query: {},
        body,
        headers: {},
        rawBody: JSON.stringify(body)
      }
      const res = createMockRes()

      await controller.handleGatewayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(paymentDoc.status, 'SUCCESS')
      assert.equal(paymentDoc.providerTransactionId, 'pay_RZP_1')
      assert.equal(paymentDoc.providerOrderId, 'order_RZP_1')
    }
  },
  {
    name: 'Razorpay event webhooks such as payment.captured trigger payout creation',
    async run() {
      const actualPaymentGateway = require('../src/services/paymentGateway.service')
      const paymentDoc = {
        _id: '507f1f77bcf86cd799439015',
        provider: 'RAZORPAY',
        providerOrderId: 'order_RZP_2',
        status: 'PENDING',
        merchantTransactionId: 'RZP-XYZ',
        payer: {
          userId: 'payer-1',
          userType: 'transporter',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          mobile: '9999999999'
        },
        paymentResponse: {},
        callbackPayload: {},
        metadata: {},
        save: async function save() {
          return this
        }
      }

      let payoutCalled = false
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payment.controller.js'),
        {
          '../services/paymentGateway.service.js': {
            ...actualPaymentGateway,
            verifyGatewayWebhook: () => true
          },
          '../services/cashfreePayout.service': {
            createAutomaticPayoutForPayment: async (payment) => {
              payoutCalled = true
              assert.equal(payment.status, 'SUCCESS')
              return {
                _id: 'payout-2',
                provider: 'RAZORPAY',
                status: 'PROCESSING',
                razorpay: {
                  payoutId: 'pout_2'
                }
              }
            }
          },
          '../models/PaymentSession': {
            findById: async () => null,
            findOne: async (query) => {
              if (query?.providerOrderId === 'order_RZP_2') {
                return paymentDoc
              }
              return null
            }
          }
        }
      )

      const body = {
        event: 'payment.captured',
        razorpay_order_id: 'order_RZP_2',
        razorpay_payment_id: 'pay_RZP_2',
        razorpay_signature: 'ignored',
        payload: {
          payment: {
            entity: {
              id: 'pay_RZP_2',
              order_id: 'order_RZP_2',
              status: 'captured'
            }
          }
        }
      }
      const req = {
        params: { provider: 'RAZORPAY' },
        query: {},
        body,
        headers: {},
        rawBody: JSON.stringify(body)
      }
      const res = createMockRes()

      await controller.handleGatewayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(paymentDoc.status, 'SUCCESS')
      assert.equal(paymentDoc.providerTransactionId, 'pay_RZP_2')
      assert.equal(paymentDoc.providerOrderId, 'order_RZP_2')
      assert.equal(payoutCalled, true)
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
  },
  {
    name: 'Marketplace milestone 1 auto-creates a Razorpay payment request',
    async run() {
      let created = false
      let broadcasted = false

      const trip = {
        _id: 'trip-1',
        status: 'ACTIVE',
        milestones: [],
        isFromBooking: true,
        bookingId: 'booking-1',
        driverId: 'driver-1',
        customerId: 'customer-1',
        populate: async function () {
          return this
        },
        save: async function () {
          return this
        },
        getCurrentMilestone() {
          return this.milestones.length ? this.milestones[this.milestones.length - 1] : null
        }
      }

      const booking = {
        _id: 'booking-1',
        agreedPrice: 7500,
        status: 'CONFIRMED',
        buyerId: {
          _id: 'buyer-1',
          name: 'Buyer A',
          company: 'Buyer A Co',
          email: 'buyer@example.com',
          mobile: '9999999999'
        },
        sellerId: {
          _id: 'seller-1'
        },
        save: async function () {
          return this
        }
      }

      const payment = {
        _id: 'payment-1',
        status: 'PENDING',
        amount: 7500,
        paymentRequest: {
          fields: {
            order_id: 'RZP-TRIP-1'
          },
          actionUrl: 'https://api.razorpay.com/checkout',
          method: 'GET',
          mode: 'sandbox'
        }
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/tripMilestone.controller.js'),
        {
          '../models/Trip': {
            findById: async () => trip
          },
          '../models/VehicleBooking': {
            findById: () => ({
              ...booking,
              populate: function () {
                return this
              }
            })
          },
          '../services/marketplacePayment.service': {
            createMarketplacePaymentRequestForTrip: async () => {
              created = true
              return payment
            },
            fetchMarketplacePaymentSnapshotByTrip: async () => ({
              marketplaceTrip: true
            })
          },
          '../services/socket.service': {
            emitTripMilestoneUpdated: () => {},
            emitMarketplacePaymentReady: async () => {
              broadcasted = true
            }
          },
          '../services/tripAccess.service': {
            canTransporterPartyViewTripExecution: async () => true
          },
          '../services/wati.service': {
            sendVehicleReachedPickupTemplate: async () => {},
            sendContainerPickedTemplate: async () => {}
          },
          '../utils/milestoneMapping': {
            getBackendMeaning: () => 'REACHED_LOCATION',
            getDriverLabel: () => 'Reached pickup',
            getMilestoneTypeByNumber: () => 'REACHED_LOCATION'
          },
          '../services/tripLifecycle.service': {
            ensureMilestonePhoto: () => null,
            toAuditUserType: () => 'DRIVER'
          }
        }
      )

      const req = {
        params: {
          id: 'trip-1',
          milestoneNumber: '1'
        },
        user: {
          id: 'driver-1',
          userType: 'driver'
        },
        body: {
          latitude: 12.9716,
          longitude: 77.5946
        }
      }
      const res = createMockRes()

      await controller.updateMilestone(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(created, true)
      assert.equal(broadcasted, true)
      assert.equal(payment.paymentRequest.fields.order_id, 'RZP-TRIP-1')
    }
  },
  {
    name: 'Razorpay webhook success triggers Razorpay payout',
    async run() {
      let payoutCalled = false

      const paymentDoc = {
        _id: '507f1f77bcf86cd799439011',
        provider: 'RAZORPAY',
        status: 'PENDING',
        merchantTransactionId: 'RZP-ABC',
        providerOrderId: 'order_123',
        payerTransporterId: 'buyer-1',
        amount: 8200,
        paymentResponse: {},
        callbackPayload: {},
        metadata: {},
        save: async function () {
          return this
        }
      }

      const bookingDoc = {
        _id: 'booking-1',
        paymentStatus: 'HOLD',
        save: async function () {
          return this
        }
      }

      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/marketplacePayment.controller.js'),
        {
          '../models/MarketplacePayment': {
            findById: async () => null,
            findOne: async () => paymentDoc
          },
          '../models/VehicleBooking': {
            findById: async () => bookingDoc
          },
          '../services/paymentGateway.service': {
            getGatewayPayloadMetadata: () => ({
              providerTransactionId: 'pay_123',
              providerOrderId: 'order_123',
              status: 'SUCCESS'
            }),
            verifyGatewayWebhook: () => true
          },
          '../services/cashfreePayout.service': {
            createAutomaticPayoutForPayment: async () => {
              payoutCalled = true
              return {
                _id: 'payout-1',
                status: 'SUCCESS',
                cashfree: {
                  transferId: 'TRF-123',
                  referenceId: 'REF-123'
                }
              }
            }
          },
          '../models/Notification': {
            create: async () => ({})
          }
        }
      )

      const req = {
        query: {},
        body: {
          razorpay_order_id: 'order_123',
          razorpay_payment_id: 'pay_123',
          razorpay_signature: 'ignored'
        },
        headers: {},
        rawBody: ''
      }
      const res = createMockRes()

      await controller.handleMarketplaceRazorpayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(paymentDoc.status, 'SUCCESS')
      assert.equal(bookingDoc.paymentStatus, 'COMPLETED')
      assert.equal(payoutCalled, true)
    }
  }
]

module.exports = paymentTests
