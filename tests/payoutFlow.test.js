const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const payoutTests = [
  {
    name: 'createRazorpayContact throws a readable message when Razorpay returns an object error',
    async run() {
      const razorpayService = require(path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'))
      const fakeFetch = async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          error: { description: 'contact already exists' },
          message: { code: 'BAD_REQUEST', description: 'contact already exists' }
        })
      })

      await assert.rejects(
        () => razorpayService.createRazorpayContact({ name: 'Test' }, fakeFetch),
        (error) => {
          assert.equal(error.message, 'contact already exists')
          return true
        }
      )
    }
  },
  {
    name: 'createRazorpayContact normalizes Vendor to the Razorpay-compatible type',
    async run() {
      const razorpayService = require(path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'))
      let capturedBody = null
      const fakeFetch = async (_url, options) => {
        capturedBody = JSON.parse(options.body)
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: 'contact_2', contact: { type: 'vendor' } })
        }
      }

      const result = await razorpayService.createRazorpayContact({ name: 'Test', type: 'Vendor' }, fakeFetch)

      assert.equal(result.data?.contact?.type || result.data?.type, 'vendor')
      assert.equal(capturedBody.type, 'vendor')
    }
  },
  {
    name: 'createRazorpayContact forwards a fetch function to the Razorpay service',
    async run() {
      let capturedFetchImpl = null
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/razorpayPayout.service': {
            createRazorpayContact: async (body, fetchImpl) => {
              capturedFetchImpl = fetchImpl
              return { id: 'contact_1', body }
            }
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        user: { id: 'admin-1', userType: 'admin' },
        body: {
          name: 'Shubham Shelke1',
          email: 'shelkeshubham011@gmail.com',
          contact: '9403884043',
          type: 'Vendor'
        },
        fetch: () => ({})
      }
      const res = createMockRes()

      await controller.createRazorpayContact(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 201)
      assert.equal(typeof capturedFetchImpl, 'function')
      assert.equal(capturedFetchImpl, req.fetch)
    }
  },
  {
    name: 'createBeneficiary rejects transporter accounts for another payee',
    async run() {
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {
            registerBeneficiary: async () => ({})
          },
          '../services/razorpayPayout.service': {
            syncRazorpayBeneficiaryForPayee: async () => ({})
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        body: {
          payeeId: 'other-payee',
          name: 'Transporter Co',
          email: 'transporter@example.com',
          phone: '9999999999',
          bankAccount: '1234567890',
          ifsc: 'HDFC0001234',
          address1: '1 Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001'
        }
      }
      const res = createMockRes()

      await controller.createBeneficiary(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 403)
      assert.equal(res.body.message, 'Access denied')
    }
  },
  {
    name: 'createBeneficiary allows transporter accounts to create their own beneficiary',
    async run() {
      let capturedArgs = null
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {
            registerBeneficiary: async (args) => {
              capturedArgs = args
              return {
                payee: {
                  name: 'Transporter One',
                  mobile: '9999999999',
                  cashfreeBeneficiary: {
                    status: 'ACTIVE',
                    bankAccountLast4: '7890',
                    createdAt: new Date('2026-07-20T00:00:00.000Z'),
                    updatedAt: new Date('2026-07-20T00:00:00.000Z')
                  }
                },
                beneId: 'TRANSPORTER_transporter-1',
                validation: { verified: true },
                verificationWarning: null
              }
            }
          },
          '../services/razorpayPayout.service': {
            syncRazorpayBeneficiaryForPayee: async () => ({})
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        body: {
          payeeId: 'transporter-1',
          name: 'Transporter One',
          email: 'transport@example.com',
          phone: '9999999999',
          bankAccount: '1234567890',
          ifsc: 'HDFC0001234',
          address1: '1 Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001'
        }
      }
      const res = createMockRes()

      await controller.createBeneficiary(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 201)
      assert.equal(capturedArgs.payeeId, 'transporter-1')
      assert.equal(res.body.data.beneficiary.name, 'Transporter One')
      assert.equal(res.body.data.beneficiary.maskedAccountNumber, '****7890')
      assert.ok(!Object.prototype.hasOwnProperty.call(res.body.data, 'beneId'))
    }
  },
  {
    name: 'createBeneficiary allows customer accounts to create their own beneficiary',
    async run() {
      let capturedArgs = null
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {
            registerBeneficiary: async (args) => {
              capturedArgs = args
              return {
                payee: {
                  name: 'Customer One',
                  mobile: '8888888888',
                  cashfreeBeneficiary: {
                    status: 'ACTIVE',
                    bankAccountLast4: '7890',
                    createdAt: new Date('2026-07-20T00:00:00.000Z'),
                    updatedAt: new Date('2026-07-20T00:00:00.000Z')
                  }
                },
                beneId: 'CUSTOMER_customer-1',
                validation: { verified: true },
                verificationWarning: null
              }
            }
          },
          '../services/razorpayPayout.service': {
            syncRazorpayBeneficiaryForPayee: async () => ({})
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        user: { id: 'customer-1', userType: 'customer' },
        body: {
          payeeId: 'customer-1',
          name: 'Customer One',
          email: 'customer@example.com',
          phone: '8888888888',
          bankAccount: '1234567890',
          ifsc: 'HDFC0001234',
          address1: '1 Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001'
        }
      }
      const res = createMockRes()

      await controller.createBeneficiary(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 201)
      assert.equal(capturedArgs.payeeId, 'customer-1')
      assert.equal(res.body.data.beneficiary.name, 'Customer One')
      assert.equal(res.body.data.beneficiary.maskedAccountNumber, '****7890')
      assert.ok(!Object.prototype.hasOwnProperty.call(res.body.data, 'beneId'))
    }
  },
  {
    name: 'createBeneficiary allows driver accounts to create their beneficiary',
    async run() {
      let capturedArgs = null
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {
            registerBeneficiary: async (args) => {
              capturedArgs = args
              return {
                payee: {
                  name: 'Driver One',
                  mobile: '9999999999',
                  cashfreeBeneficiary: {
                    status: 'ACTIVE',
                    bankAccountLast4: '7890',
                    createdAt: new Date('2026-07-20T00:00:00.000Z'),
                    updatedAt: new Date('2026-07-20T00:00:00.000Z')
                  }
                },
                beneId: 'DRIVER_driver-1',
                validation: { verified: true },
                verificationWarning: null
              }
            }
          },
          '../services/razorpayPayout.service': {
            syncRazorpayBeneficiaryForPayee: async () => ({})
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        user: { id: 'driver-1', userType: 'driver' },
        body: {
          payeeId: 'driver-1',
          name: 'Driver One',
          email: 'driver@example.com',
          phone: '9999999999',
          bankAccount: '1234567890',
          ifsc: 'HDFC0001234',
          address1: '1 Road',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001'
        }
      }
      const res = createMockRes()

      await controller.createBeneficiary(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 201)
      assert.equal(capturedArgs.payeeId, 'driver-1')
      assert.equal(res.body.data.beneficiary.name, 'Driver One')
      assert.equal(res.body.data.beneficiary.maskedAccountNumber, '****7890')
      assert.ok(!Object.prototype.hasOwnProperty.call(res.body.data, 'beneId'))
    }
  },
  {
    name: 'registerBeneficiary stores Cashfree beneficiary details on the payee',
    async run() {
      const payeeDoc = {
        _id: 'payee-1',
        name: 'Alpha Logistics',
        email: 'alpha@example.com',
        mobile: '9999999999',
        cashfreeBeneficiary: null,
        async save() {
          return this
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': {
            findById: async (id) => (id === 'payee-1' ? payeeDoc : null)
          },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null },
          '../models/PaymentSession': {},
          '../models/Payout': {}
        }
      )

      const originalFetch = global.fetch
      global.fetch = async (url, options = {}) => {
        if (String(url).includes('/beneficiary')) {
          const payload = JSON.parse(options.body || '{}')
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              data: {
                beneficiary_id: payload.beneficiary_id || payload.beneId,
                status: 'ACTIVE'
              }
            })
          }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      try {
        const result = await service.registerBeneficiary({
          payeeId: 'payee-1',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          phone: '9999999999',
          bankAccount: '1234567890',
          ifsc: 'HDFC0001234',
          address: {
            address1: '1 Alpha Street',
            city: 'Mumbai',
            state: 'Maharashtra',
            pincode: '400001',
            country: 'IN'
          }
        })

        assert.match(result.beneId, /^BENE_[0-9A-HJKMNP-TV-Z]{26}$/)
        assert.equal(payeeDoc.cashfreeBeneficiary.beneId, result.beneId)
        assert.equal(payeeDoc.cashfreeBeneficiary.status, 'ACTIVE')
        assert.ok(payeeDoc.cashfreeBeneficiary.verifiedAt instanceof Date)
        assert.equal(payeeDoc.cashfreeBeneficiary.providerResponse.status, 'ACTIVE')
        assert.equal(
          payeeDoc.cashfreeBeneficiary.providerResponse.data.beneficiary_id,
          result.beneId
        )
        // Bank details must never be persisted locally; only the last 4
        // digits are kept for masked display. Cashfree holds the full data.
        assert.equal(payeeDoc.cashfreeBeneficiary.bankAccountEncrypted, undefined)
        assert.equal(payeeDoc.cashfreeBeneficiary.ifscEncrypted, undefined)
        assert.equal(payeeDoc.cashfreeBeneficiary.bankAccountLast4, '7890')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'getRegisteredBeneficiary fetches a beneficiary from Cashfree by payee id',
    async run() {
      const payeeDoc = {
        _id: 'payee-1',
        name: 'Alpha Logistics',
        email: 'alpha@example.com',
        mobile: '9999999999',
        cashfreeBeneficiary: {
          beneId: 'TRANSPORTER_payee-1',
          status: 'ACTIVE'
        },
        async save() {
          return this
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': {
            findById: async (id) => (id === 'payee-1' ? payeeDoc : null),
            findOne: async () => null
          },
          '../models/Driver': { findById: async () => null, findOne: async () => null },
          '../models/Customer': { findById: async () => null, findOne: async () => null },
          '../models/PumpOwner': { findById: async () => null, findOne: async () => null },
          '../models/CompanyUser': { findById: async () => null, findOne: async () => null },
          '../models/PaymentSession': {},
          '../models/Payout': {}
        }
      )

      const calls = []
      const originalFetch = global.fetch
      global.fetch = async (url) => {
        calls.push(String(url))
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            beneficiary_id: 'TRANSPORTER_payee-1',
            beneficiary_name: 'Alpha Logistics',
            beneficiary_status: 'VERIFIED'
          })
        }
      }

      try {
        const result = await service.getRegisteredBeneficiary({
          payeeId: 'payee-1'
        })

        assert.equal(result.payee._id, 'payee-1')
        assert.match(calls[0], /beneficiary_id=TRANSPORTER_payee-1/)
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'removeRegisteredBeneficiary marks the local payee beneficiary as deleted',
    async run() {
      const payeeDoc = {
        _id: 'payee-1',
        name: 'Alpha Logistics',
        email: 'alpha@example.com',
        mobile: '9999999999',
        cashfreeBeneficiary: {
          beneId: 'TRANSPORTER_payee-1',
          status: 'ACTIVE',
          verification: {
            beneficiary_status: 'VERIFIED'
          }
        },
        async save() {
          return this
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': {
            findById: async (id) => (id === 'payee-1' ? payeeDoc : null),
            findOne: async () => payeeDoc
          },
          '../models/Driver': { findById: async () => null, findOne: async () => null },
          '../models/Customer': { findById: async () => null, findOne: async () => null },
          '../models/PumpOwner': { findById: async () => null, findOne: async () => null },
          '../models/CompanyUser': { findById: async () => null, findOne: async () => null },
          '../models/PaymentSession': {},
          '../models/Payout': {}
        }
      )

      const calls = []
      const originalFetch = global.fetch
      global.fetch = async (url, options = {}) => {
        calls.push({
          url: String(url),
          method: options.method
        })
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            beneficiary_id: 'TRANSPORTER_payee-1',
            beneficiary_status: 'DELETED'
          })
        }
      }

      try {
        const result = await service.removeRegisteredBeneficiary({
          payeeId: 'payee-1'
        })

        assert.equal(result.beneficiaryId, 'TRANSPORTER_payee-1')
        assert.equal(calls[0].method, 'DELETE')
        assert.equal(payeeDoc.cashfreeBeneficiary.status, 'DELETED')
        assert.ok(payeeDoc.cashfreeBeneficiary.deletedAt instanceof Date)
        assert.equal(
          payeeDoc.cashfreeBeneficiary.removalResponse.beneficiary_status,
          'DELETED'
        )
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'automatic payout transitions to success when Cashfree accepts the transfer',
    async run() {
      let payoutDoc = null
      class MockPayout {
        constructor(doc = {}) {
          Object.assign(this, doc)
          this._id = this._id || 'payout-1'
        }

        toObject() {
          return {
            ...this,
            _id: this._id
          }
        }

        async save() {
          payoutDoc = this
          return this
        }
      }

      MockPayout.findOne = (query = {}) => {
        if (query.status === 'SUCCESS' || query._id) {
          return null
        }

        return {
          sort: async () => null
        }
      }

      MockPayout.findOneAndUpdate = async (_query, update) => {
        payoutDoc = new MockPayout({
          ...(payoutDoc || {}),
          ...(update?.$set || {})
        })
        return payoutDoc
      }

      MockPayout.findById = async (id) => {
        if (!payoutDoc) {
          return null
        }

        if (id && String(id) !== String(payoutDoc._id)) {
          return null
        }

        return payoutDoc
      }

      MockPayout.collection = {
        insertOne: async (doc) => {
          payoutDoc = new MockPayout({
            ...doc,
            _id: 'payout-1'
          })
          return { insertedId: 'payout-1' }
        }
      }

      MockPayout.countDocuments = async () => 0
      MockPayout.modelName = 'Payout'

      const paymentDoc = {
        _id: 'payment-1',
        provider: 'CASHFREE',
        status: 'SUCCESS',
        amount: 5000,
        currency: 'INR',
        payer: { userId: 'payer-1' },
        metadata: {
          payout: {
            payeeId: 'payee-1',
            payeeType: 'TRANSPORTER',
            transferMode: 'IMPS'
          }
        }
      }

      const payeeDoc = {
        _id: 'payee-1',
        cashfreeBeneficiary: {
          beneId: 'TRANSPORTER_payee-1',
          status: 'ACTIVE'
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': {
            findById: async (id) => (id === 'payee-1' ? payeeDoc : null)
          },
        '../models/Driver': { findById: async () => null },
        '../models/Customer': { findById: async () => null },
        '../models/PumpOwner': { findById: async () => null },
        '../models/CompanyUser': { findById: async () => null },
        '../models/PaymentSession': {
          findById: async (id) => (id === 'payment-1' ? paymentDoc : null)
        },
        '../models/Payout': MockPayout,
        '../services/razorpayPayout.service': {}
      }
      )

      const originalFetch = global.fetch
      global.fetch = async (url) => {
        if (String(url).includes('/transfers')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              data: {
                status: 'SUCCESS',
                transferId: 'TRF-1',
                utr: 'UTR-123456'
              }
            })
          }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      try {
        const payout = await service.createAutomaticPayoutForPayment(paymentDoc)

        assert.equal(payout.provider, 'CASHFREE')
        assert.equal(payout.status, 'SUCCESS')
        assert.equal(payout.cashfree.transferId, 'TRF-1')
        assert.equal(payout.cashfree.utr, 'UTR-123456')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'automatic payout dispatches to Razorpay when the pay-in provider is Razorpay',
    async run() {
      let capturedPayment = null
      let capturedFetchImpl = null

      const paymentDoc = {
        _id: 'payment-razorpay-dispatch',
        provider: 'RAZORPAY',
        status: 'SUCCESS',
        amount: 2500,
        currency: 'INR',
        payer: { userId: 'payer-1' },
        metadata: {
          payout: {
            payeeId: 'payee-1',
            payeeType: 'TRANSPORTER',
            transferMode: 'IMPS'
          }
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': { findById: async () => null },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null },
          '../models/PaymentSession': {
            findById: async (id) => (id === paymentDoc._id ? paymentDoc : null)
          },
          '../models/Payout': {},
          '../services/razorpayPayout.service': {
            createAutomaticPayoutForPayment: async (paymentInput, options) => {
              capturedPayment = paymentInput
              capturedFetchImpl = options?.fetchImpl
              return {
                _id: 'payout-razorpay-dispatch',
                provider: 'RAZORPAY',
                status: 'SUCCESS',
                razorpay: {
                  payoutId: 'pout_dispatch',
                  referenceId: 'ref_dispatch'
                }
              }
            }
          }
        }
      )

      const fakeFetch = async () => {
        throw new Error('Cashfree fetch should not be used for Razorpay pay-ins')
      }

      const payout = await service.createAutomaticPayoutForPayment(paymentDoc, {
        fetchImpl: fakeFetch
      })

      assert.equal(capturedPayment._id, paymentDoc._id)
      assert.equal(capturedPayment.provider, 'RAZORPAY')
      assert.equal(capturedFetchImpl, fakeFetch)
      assert.equal(payout.provider, 'RAZORPAY')
      assert.equal(payout.razorpay.payoutId, 'pout_dispatch')
    }
  },
  {
    name: 'requestAsyncTransfer sanitizes transfer remarks before sending to Cashfree',
    async run() {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': {},
          '../models/Driver': {},
          '../models/Customer': {},
          '../models/PumpOwner': {},
          '../models/CompanyUser': {},
          '../models/PaymentSession': {},
          '../models/Payout': {}
        }
      )

      const calls = []
      const originalFetch = global.fetch
      global.fetch = async (url, options = {}) => {
        calls.push({
          url,
          body: JSON.parse(options.body || '{}')
        })
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: {
              status: 'SUCCESS',
              transferId: 'TRF-1'
            }
          })
        }
      }

      try {
        await service.requestAsyncTransfer({
          beneId: 'BEN-1',
          amount: 5000,
          transferId: 'TRF-1',
          transferMode: 'IMPS',
          remarks: 'TRIP_2013'
        })

        assert.equal(calls[0].body.transfer_remarks, 'TRIP 2013')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'automatic payout marks failed when Cashfree rejects deprecated API with 403',
    async run() {
      let payoutDoc = null
      class MockPayout {
        constructor(doc = {}) {
          Object.assign(this, doc)
          this._id = this._id || 'payout-403'
        }

        toObject() {
          return {
            ...this,
            _id: this._id
          }
        }

        async save() {
          payoutDoc = this
          return this
        }
      }

      MockPayout.findOne = (query = {}) => {
        if (query.status === 'SUCCESS' || query._id) {
          return null
        }

        return {
          sort: async () => null
        }
      }

      MockPayout.findOneAndUpdate = async (_query, update) => {
        payoutDoc = new MockPayout({
          ...(payoutDoc || {}),
          ...(update?.$set || {})
        })
        return payoutDoc
      }

      MockPayout.findById = async (id) => {
        if (!payoutDoc) {
          return null
        }

        if (id && String(id) !== String(payoutDoc._id)) {
          return null
        }

        return payoutDoc
      }

      MockPayout.collection = {
        insertOne: async (doc) => {
          payoutDoc = new MockPayout({
            ...doc,
            _id: 'payout-403'
          })
          return { insertedId: 'payout-403' }
        }
      }

      MockPayout.countDocuments = async () => 0
      MockPayout.modelName = 'Payout'

      const paymentDoc = {
        _id: 'payment-403',
        provider: 'CASHFREE',
        status: 'SUCCESS',
        amount: 5000,
        currency: 'INR',
        payer: { userId: 'payer-1' },
        metadata: {
          payout: {
            payeeId: 'payee-1',
            payeeType: 'TRANSPORTER',
            transferMode: 'IMPS'
          }
        }
      }

      const payeeDoc = {
        _id: 'payee-1',
        cashfreeBeneficiary: {
          beneId: 'TRANSPORTER_payee-1',
          status: 'ACTIVE'
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': {
            findById: async (id) => (id === 'payee-1' ? payeeDoc : null)
          },
        '../models/Driver': { findById: async () => null },
        '../models/Customer': { findById: async () => null },
        '../models/PumpOwner': { findById: async () => null },
        '../models/CompanyUser': { findById: async () => null },
        '../models/PaymentSession': {
          findById: async (id) => (id === 'payment-403' ? paymentDoc : null)
        },
        '../models/Payout': MockPayout,
        '../services/razorpayPayout.service': {}
      }
      )

      const originalFetch = global.fetch
      global.fetch = async (url) => {
        if (String(url).includes('/transfers')) {
          return {
            ok: false,
            status: 403,
            text: async () => JSON.stringify({
              status: 'ERROR',
              subCode: '403',
              message: 'The payout v1 and v1.2 APIs have been deprecated. Please use v2 APIs.'
            })
          }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      try {
        const payout = await service.createAutomaticPayoutForPayment(paymentDoc)

        assert.equal(payout.provider, 'CASHFREE')
        assert.equal(payout.status, 'FAILED')
        assert.equal(payout.failure.code, '403')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'syncRazorpayBeneficiaryForPayee stores Razorpay beneficiary details on the payee',
    async run() {
      const payeeDoc = {
        _id: 'payee-1',
        name: 'Alpha Logistics',
        email: 'alpha@example.com',
        mobile: '9999999999',
        razorpayBeneficiary: null,
        async save() {
          return this
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutMode: 'sandbox',
            razorpayPayoutKeyId: 'rzp_key_id',
            razorpayPayoutKeySecret: 'rzp_key_secret',
            razorpayPayoutWebhookSecret: 'rzp_webhook_secret',
            razorpayPayoutApiBaseUrl: 'https://api.razorpay.com/v1',
            razorpayPayoutAccountNumber: '1234567890'
          },
          '../models/Transporter': {
            findById: async (id) => (id === 'payee-1' ? payeeDoc : null)
          },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null },
          '../models/PaymentSession': {},
          '../models/Payout': {}
        }
      )

      const calls = []
      const originalFetch = global.fetch
      global.fetch = async (url, options = {}) => {
        calls.push({
          url: String(url),
          body: JSON.parse(options.body || '{}')
        })

        if (String(url).includes('/contacts')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ id: 'cont_1' })
          }
        }

        if (String(url).includes('/fund_accounts')) {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ id: 'fa_1' })
          }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      try {
        const result = await service.syncRazorpayBeneficiaryForPayee({
          payeeId: 'payee-1',
          name: 'Alpha Logistics',
          email: 'alpha@example.com',
          phone: '9999999999',
          bankAccount: '1234567890',
          ifsc: 'HDFC0001234'
        })

        assert.equal(result.contactId, 'cont_1')
        assert.equal(result.fundAccountId, 'fa_1')
        assert.equal(payeeDoc.razorpayBeneficiary.contactId, 'cont_1')
        assert.equal(payeeDoc.razorpayBeneficiary.fundAccountId, 'fa_1')
        assert.equal(calls[0].body.contact, '9999999999')
        assert.equal(calls[1].body.bank_account.ifsc, 'HDFC0001234')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'automatic payout transitions to success when RazorpayX accepts the transfer',
    async run() {
      let payoutDoc = null
      const payeeDoc = {
        _id: 'payee-1',
        razorpayBeneficiary: {
          contactId: 'cont_1',
          fundAccountId: 'fa_1',
          status: 'ACTIVE'
        }
      }

      const paymentDoc = {
        _id: 'payment-razorpay-1',
        status: 'SUCCESS',
        amount: 5000,
        currency: 'INR',
        payer: { userId: 'payer-1' },
        metadata: {
          payout: {
            payeeId: 'payee-1',
            payeeType: 'TRANSPORTER',
            transferMode: 'IMPS'
          }
        }
      }

      class MockPayout {
        constructor(doc) {
          this._id = doc._id || 'payout-1'
          Object.assign(this, doc)
        }
        async save() {
          payoutDoc = this
          return this
        }
      }
      MockPayout.findOne = (query = {}) => {
        if (query.status === 'SUCCESS' || query._id) {
          return null
        }

        return {
          sort: async () => null
        }
      }
      MockPayout.findOneAndUpdate = async (_query, update) => {
        payoutDoc = new MockPayout({
          ...(payoutDoc || {}),
          ...(update?.$set || {})
        })
        return payoutDoc
      }
      MockPayout.findById = async () => payoutDoc
      MockPayout.countDocuments = async () => 0

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutMode: 'sandbox',
            razorpayPayoutKeyId: 'rzp_key_id',
            razorpayPayoutKeySecret: 'rzp_key_secret',
            razorpayPayoutWebhookSecret: 'rzp_webhook_secret',
            razorpayPayoutApiBaseUrl: 'https://api.razorpay.com/v1',
            razorpayPayoutAccountNumber: '1234567890'
          },
          '../models/Transporter': {
            findById: async (id) => (id === 'payee-1' ? payeeDoc : null)
          },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null },
          '../models/PaymentSession': {
            findById: async (id) => (id === paymentDoc._id ? paymentDoc : null)
          },
          '../models/Payout': MockPayout
        }
      )

      const originalFetch = global.fetch
      global.fetch = async (url, options = {}) => {
        if (String(url).includes('/payouts')) {
          const requestBody = JSON.parse(options.body || '{}')
          assert.equal(requestBody.fund_account_id, 'fa_1')
          assert.equal(requestBody.reference_id, 'payout-1')
          assert.equal(requestBody.narration, 'Porttivo payout')
          assert.equal(options.headers['X-Payout-Idempotency'], 'RZP-payout-1')
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              id: 'pout_1',
              status: 'processed',
              fund_account_id: 'fa_1',
              reference_id: 'payout-1'
            })
          }
        }

        throw new Error(`Unexpected fetch URL: ${url}`)
      }

      try {
        const payout = await service.createAutomaticPayoutForPayment(paymentDoc)

        assert.equal(payout.provider, 'RAZORPAY')
        assert.equal(payout.status, 'SUCCESS')
        assert.equal(payout.razorpay.payoutId, 'pout_1')
        assert.equal(payout.razorpay.fundAccountId, 'fa_1')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'syncRazorpayPayoutStatus refreshes an existing payout from Razorpay',
    async run() {
      const payoutDoc = {
        _id: 'payout-1',
        provider: 'RAZORPAY',
        status: 'PROCESSING',
        retry: { count: 0, maxRetry: 3, nextRetryAt: null },
        failure: {},
        razorpay: {
          payoutId: 'pout_123',
          referenceId: null,
          response: {}
        },
        async save() {
          return this
        }
      }

      const service = require(path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'))

      const originalFetch = global.fetch
      global.fetch = async (url) => {
        assert.equal(String(url), 'https://api.razorpay.com/v1/payouts/pout_123')
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            id: 'pout_123',
            status: 'processed',
            reference_id: 'ref-001',
            utr: 'UTR-001',
            status_details: { reason: 'Cleared' }
          })
        }
      }

      try {
        const updated = await service.syncRazorpayPayoutStatus(payoutDoc)
        assert.equal(updated.status, 'SUCCESS')
        assert.equal(updated.razorpay.referenceId, 'ref-001')
        assert.equal(updated.razorpay.utr, 'UTR-001')
        assert.ok(updated.completedAt instanceof Date)
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'verifyRazorpayPayoutWebhook accepts a signature computed from the exact raw body',
    async run() {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutWebhookSecret: 'whsec_test_exact'
          },
          '../utils/logger': {
            info: () => {},
            warn: () => {},
            error: () => {}
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const rawBody =
        '{"event":"payout.processed","payload":{"payout":{"entity":{"id":"pout_123","reference_id":"ref_123","status":"processed"}}}}'
      const signature = require('node:crypto')
        .createHmac('sha256', 'whsec_test_exact')
        .update(rawBody)
        .digest('hex')

      const verification = service.verifyRazorpayPayoutWebhook(
        JSON.parse(rawBody),
        {
          'x-razorpay-signature': signature
        },
        rawBody
      )

      assert.equal(verification.valid, true)
      assert.equal(verification.payoutId, 'pout_123')
      assert.equal(verification.referenceId, 'ref_123')
      assert.equal(verification.eventName, 'payout.processed')
    }
  },
  {
    name: 'verifyRazorpayPayoutWebhook rejects when the raw body whitespace changes',
    async run() {
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutWebhookSecret: 'whsec_test_whitespace'
          },
          '../utils/logger': {
            info: () => {},
            warn: () => {},
            error: () => {}
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const rawBody = '{"event":"payout.pending","payload":{"payout":{"entity":{"id":"pout_456","status":"pending"}}}}'
      const signature = require('node:crypto')
        .createHmac('sha256', 'whsec_test_whitespace')
        .update(rawBody)
        .digest('hex')

      const verification = service.verifyRazorpayPayoutWebhook(
        JSON.parse(rawBody),
        {
          'x-razorpay-signature': signature
        },
        ` ${rawBody} `
      )

      assert.equal(verification.valid, false)
    }
  },
  {
    name: 'invalid Razorpay webhook signatures return 400',
    async run() {
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {},
          '../services/razorpayPayout.service': {
            verifyRazorpayPayoutWebhook: () => ({
              valid: false,
              reason: 'signature_mismatch',
              signaturePresent: true,
              eventName: 'payout.processed',
              payoutId: 'pout_1',
              referenceId: 'ref_1'
            }),
            processRazorpayPayoutWebhook: async () => {
              throw new Error('process should not run')
            }
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        method: 'POST',
        headers: {
          'x-razorpay-signature': 'invalid'
        },
        body: {
          event: 'payout.processed'
        },
        rawBody: '{"event":"payout.processed"}'
      }
      const res = createMockRes()

      await controller.handleRazorpayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 400)
      assert.equal(res.body.message, 'Invalid Razorpay payout webhook signature')
    }
  },
  {
    name: 'valid Razorpay webhooks return 200 before background processing completes',
    async run() {
      let processStarted = false
      let processFinished = false
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {},
          '../services/razorpayPayout.service': {
            verifyRazorpayPayoutWebhook: () => ({
              valid: true,
              reason: null,
              signaturePresent: true,
              eventName: 'payout.processed',
              payoutId: 'pout_1',
              referenceId: 'ref_1'
            }),
            processRazorpayPayoutWebhook: async () => {
              processStarted = true
              await new Promise((resolve) => setTimeout(resolve, 100))
              processFinished = true
              return { status: 'SUCCESS' }
            }
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        method: 'POST',
        headers: {
          'x-razorpay-signature': 'valid'
        },
        body: {
          event: 'payout.processed'
        },
        rawBody: '{"event":"payout.processed"}'
      }
      const res = createMockRes()
      const startedAt = Date.now()

      await controller.handleRazorpayWebhook(req, res, (error) => {
        throw error
      })

      const elapsedMs = Date.now() - startedAt

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.message, 'Razorpay payout webhook received')
      assert.ok(elapsedMs < 80)
      assert.equal(processFinished, false)

      await new Promise((resolve) => setTimeout(resolve, 140))
      assert.equal(processStarted, true)
      assert.equal(processFinished, true)
    }
  },
  {
    name: 'valid Razorpay webhooks do not return 404 when the payout record is missing',
    async run() {
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {},
          '../services/razorpayPayout.service': {
            verifyRazorpayPayoutWebhook: () => ({
              valid: true,
              reason: null,
              signaturePresent: true,
              eventName: 'payout.processed',
              payoutId: 'pout_missing',
              referenceId: 'ref_missing'
            }),
            processRazorpayPayoutWebhook: async () => null
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        method: 'POST',
        headers: {
          'x-razorpay-signature': 'valid'
        },
        body: {
          event: 'payout.processed'
        },
        rawBody: '{"event":"payout.processed"}'
      }
      const res = createMockRes()

      await controller.handleRazorpayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.message, 'Razorpay payout webhook received')
    }
  },
  {
    name: 'unknown Razorpay payouts are logged and ignored after acknowledgment',
    async run() {
      const warnings = []
      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutWebhookSecret: 'whsec_unknown'
          },
          '../utils/logger': {
            info: () => {},
            warn: (...args) => warnings.push(args),
            error: () => {}
          },
          '../models/Payout': {
            findOne: () => ({
              sort: async () => null
            })
          },
          '../models/PaymentSession': {}
        }
      )

      const rawBody =
        '{"event":"payout.processed","payload":{"payout":{"entity":{"id":"pout_unknown","reference_id":"ref_unknown","status":"processed"}}}}'
      const signature = require('node:crypto')
        .createHmac('sha256', 'whsec_unknown')
        .update(rawBody)
        .digest('hex')

      const result = await service.processRazorpayPayoutWebhook({
        body: JSON.parse(rawBody),
        headers: {
          'x-razorpay-signature': signature
        },
        rawBody
      })

      assert.equal(result, null)
      assert.ok(warnings.length >= 1)
    }
  },
  {
    name: 'duplicate Razorpay webhooks do not create duplicate payouts',
    async run() {
      let saveCount = 0
      let createCount = 0
      const payoutDoc = {
        _id: 'payout-dup-1',
        provider: 'RAZORPAY',
        status: 'PROCESSING',
        razorpay: {
          payoutId: 'pout_dup_1',
          referenceId: 'ref_dup_1'
        },
        async save() {
          saveCount += 1
          return this
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutWebhookSecret: 'whsec_dup'
          },
          '../utils/logger': {
            info: () => {},
            warn: () => {},
            error: () => {}
          },
          '../models/Payout': {
            findOne: () => ({
              sort: async () => payoutDoc
            }),
            create: async () => {
              createCount += 1
              throw new Error('create should not be called')
            }
          },
          '../models/PaymentSession': {}
        }
      )

      const originalFetch = global.fetch
      global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'pout_dup_1',
          status: 'processed',
          reference_id: 'ref_dup_1'
        })
      })

      const rawBody =
        '{"event":"payout.processed","payload":{"payout":{"entity":{"id":"pout_dup_1","reference_id":"ref_dup_1","status":"processed"}}}}'
      const signature = require('node:crypto')
        .createHmac('sha256', 'whsec_dup')
        .update(rawBody)
        .digest('hex')

      try {
        await service.processRazorpayPayoutWebhook({
          body: JSON.parse(rawBody),
          headers: {
            'x-razorpay-signature': signature
          },
          rawBody
        })
        await service.processRazorpayPayoutWebhook({
          body: JSON.parse(rawBody),
          headers: {
            'x-razorpay-signature': signature
          },
          rawBody
        })
      } finally {
        global.fetch = originalFetch
      }

      assert.equal(createCount, 0)
      assert.ok(saveCount >= 2)
      assert.equal(payoutDoc.status, 'SUCCESS')
    }
  },
  {
    name: 'Razorpay webhook event IDs are deduplicated and new IDs still process',
    async run() {
      let saveCount = 0
      let claimCount = 0
      let payoutDoc = null
      class MockPayout {
        constructor(doc = {}) {
          Object.assign(this, doc)
          this._id = this._id || 'payout-event-1'
        }

        async save() {
          saveCount += 1
          payoutDoc = this
          return this
        }
      }

      MockPayout.findOne = () => ({
        sort: async () => payoutDoc
      })

      MockPayout.findOneAndUpdate = async (_query, update) => {
        const eventId = update?.$set?.['razorpay.lastWebhookEventId']
        if (payoutDoc?.razorpay?.lastWebhookEventId === eventId) {
          return null
        }

        claimCount += 1
        payoutDoc = new MockPayout({
          ...(payoutDoc || {}),
          lastWebhookAt: update?.$set?.lastWebhookAt || payoutDoc?.lastWebhookAt || null,
          razorpay: {
            ...(payoutDoc?.razorpay || {}),
            lastWebhookEventId: eventId
          }
        })
        return payoutDoc
      }

      MockPayout.findById = async () => payoutDoc
      MockPayout.countDocuments = async () => 0

      payoutDoc = new MockPayout({
        provider: 'RAZORPAY',
        status: 'PROCESSING',
        razorpay: {
          payoutId: 'pout_event_1',
          referenceId: 'ref_event_1',
          response: {}
        },
        retry: { count: 0, maxRetry: 3, nextRetryAt: null },
        failure: {},
        async save() {
          saveCount += 1
          return this
        }
      })

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutWebhookSecret: 'whsec_event'
          },
          '../utils/logger': {
            info: () => {},
            warn: () => {},
            error: () => {}
          },
          '../models/Payout': MockPayout,
          '../models/PaymentSession': {}
        }
      )

      const originalFetch = global.fetch
      global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'pout_event_1',
          status: 'processed',
          reference_id: 'ref_event_1'
        })
      })

      const rawBody =
        '{"event":"payout.processed","payload":{"payout":{"entity":{"id":"pout_event_1","reference_id":"ref_event_1","status":"processed"}}}}'
      const signature = require('node:crypto')
        .createHmac('sha256', 'whsec_event')
        .update(rawBody)
        .digest('hex')

      try {
        const first = await service.processRazorpayPayoutWebhook({
          body: JSON.parse(rawBody),
          headers: {
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': 'evt_test_001'
          },
          rawBody
        })
        const afterFirst = saveCount

        const duplicate = await service.processRazorpayPayoutWebhook({
          body: JSON.parse(rawBody),
          headers: {
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': 'evt_test_001'
          },
          rawBody
        })
        const afterDuplicate = saveCount

        const third = await service.processRazorpayPayoutWebhook({
          body: JSON.parse(rawBody),
          headers: {
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': 'evt_test_002'
          },
          rawBody
        })

        assert.ok(first)
        assert.equal(duplicate, null)
        assert.ok(third)
        assert.equal(claimCount, 2)
        assert.equal(afterDuplicate, afterFirst)
        assert.ok(saveCount > afterDuplicate)
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'simultaneous Razorpay webhooks with the same event ID only claim once',
    async run() {
      let saveCount = 0
      let claimCount = 0
      let inFlight = false
      let payoutDoc = null
      class MockPayout {
        constructor(doc = {}) {
          Object.assign(this, doc)
          this._id = this._id || 'payout-event-2'
        }

        async save() {
          saveCount += 1
          payoutDoc = this
          return this
        }
      }

      MockPayout.findOne = () => ({
        sort: async () => payoutDoc
      })

      MockPayout.findOneAndUpdate = async (_query, update) => {
        const eventId = update?.$set?.['razorpay.lastWebhookEventId']
        if (inFlight || payoutDoc?.razorpay?.lastWebhookEventId === eventId) {
          return null
        }

        inFlight = true
        claimCount += 1
        await new Promise((resolve) => setTimeout(resolve, 25))
        payoutDoc = new MockPayout({
          ...(payoutDoc || {}),
          lastWebhookAt: update?.$set?.lastWebhookAt || payoutDoc?.lastWebhookAt || null,
          razorpay: {
            ...(payoutDoc?.razorpay || {}),
            lastWebhookEventId: eventId
          }
        })
        inFlight = false
        return payoutDoc
      }

      MockPayout.findById = async () => payoutDoc
      MockPayout.countDocuments = async () => 0

      payoutDoc = new MockPayout({
        provider: 'RAZORPAY',
        status: 'PROCESSING',
        razorpay: {
          payoutId: 'pout_event_2',
          referenceId: 'ref_event_2',
          response: {}
        },
        retry: { count: 0, maxRetry: 3, nextRetryAt: null },
        failure: {},
        async save() {
          saveCount += 1
          return this
        }
      })

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutWebhookSecret: 'whsec_event_2'
          },
          '../utils/logger': {
            info: () => {},
            warn: () => {},
            error: () => {}
          },
          '../models/Payout': MockPayout,
          '../models/PaymentSession': {}
        }
      )

      const originalFetch = global.fetch
      global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'pout_event_2',
          status: 'processed',
          reference_id: 'ref_event_2'
        })
      })

      const rawBody =
        '{"event":"payout.processed","payload":{"payout":{"entity":{"id":"pout_event_2","reference_id":"ref_event_2","status":"processed"}}}}'
      const signature = require('node:crypto')
        .createHmac('sha256', 'whsec_event_2')
        .update(rawBody)
        .digest('hex')

      try {
        const results = await Promise.all([
          service.processRazorpayPayoutWebhook({
            body: JSON.parse(rawBody),
            headers: {
              'x-razorpay-signature': signature,
              'x-razorpay-event-id': 'evt_test_003'
            },
            rawBody
          }),
          service.processRazorpayPayoutWebhook({
            body: JSON.parse(rawBody),
            headers: {
              'x-razorpay-signature': signature,
              'x-razorpay-event-id': 'evt_test_003'
            },
            rawBody
          })
        ])

        assert.equal(results.filter(Boolean).length, 1)
        assert.equal(claimCount, 1)
        assert.ok(saveCount >= 1)
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'SUCCESS payouts are not regressed to PROCESSING by older Razorpay webhooks',
    async run() {
      const payoutDoc = {
        _id: 'payout-regress-1',
        provider: 'RAZORPAY',
        status: 'SUCCESS',
        completedAt: new Date('2026-08-24T00:00:00.000Z'),
        razorpay: {
          payoutId: 'pout_regress_1',
          referenceId: 'ref_regress_1',
          response: {}
        },
        retry: { count: 0, maxRetry: 3, nextRetryAt: null },
        failure: {},
        async save() {
          return this
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/razorpayPayout.service.js'),
        {
          '../config/env': {
            razorpayPayoutWebhookSecret: 'whsec_regress'
          },
          '../utils/logger': {
            info: () => {},
            warn: () => {},
            error: () => {}
          },
          '../models/Payout': {
            findOne: () => ({
              sort: async () => payoutDoc
            })
          },
          '../models/PaymentSession': {}
        }
      )

      const originalFetch = global.fetch
      global.fetch = async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          id: 'pout_regress_1',
          status: 'pending',
          reference_id: 'ref_regress_1'
        })
      })

      const rawBody =
        '{"event":"payout.pending","payload":{"payout":{"entity":{"id":"pout_regress_1","reference_id":"ref_regress_1","status":"pending"}}}}'
      const signature = require('node:crypto')
        .createHmac('sha256', 'whsec_regress')
        .update(rawBody)
        .digest('hex')

      try {
        const result = await service.processRazorpayPayoutWebhook({
          body: JSON.parse(rawBody),
          headers: {
            'x-razorpay-signature': signature
          },
          rawBody
        })

        assert.equal(result.status, 'SUCCESS')
      } finally {
        global.fetch = originalFetch
      }
    }
  },
  {
    name: 'GET /api/payouts/razorpay/webhook returns 200',
    async run() {
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {},
          '../services/razorpayPayout.service': {
            verifyRazorpayPayoutWebhook: () => {
              throw new Error('GET should not verify signatures')
            },
            processRazorpayPayoutWebhook: async () => null
          },
          '../models/Payout': {},
          '../models/PaymentSession': {}
        }
      )

      const req = {
        method: 'GET',
        headers: {},
        body: {},
        rawBody: ''
      }
      const res = createMockRes()

      await controller.handleRazorpayWebhook(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.message, 'Razorpay payout webhook endpoint reachable')
    }
  },
  {
    name: 'Razorpay webhook route is registered before JWT authentication',
    async run() {
      const router = require(path.resolve(process.cwd(), 'src/routes/payout.routes.js'))
      const layers = router.stack || []
      const razorpayWebhookIndex = layers.findIndex((layer) => layer.route?.path === '/razorpay/webhook')
      const authIndex = layers.findIndex((layer) => layer.name === 'authenticate')

      assert.ok(razorpayWebhookIndex >= 0)
      assert.ok(authIndex >= 0)
      assert.ok(razorpayWebhookIndex < authIndex)
    }
  },
  {
    name: 'Cashfree payout webhook marks a payout successful',
    async run() {
      const payoutDoc = {
        _id: 'payout-1',
        cashfree: {
          beneId: 'TRANSPORTER_payee-1',
          transferId: 'TRF-1',
          transferMode: 'IMPS',
          response: {},
          request: {}
        },
        status: 'PROCESSING',
        retry: { count: 0, maxRetry: 3, nextRetryAt: null },
        failure: {},
        async save() {
          return this
        }
      }

      const service = loadWithMocks(
        path.resolve(process.cwd(), 'src/services/cashfreePayout.service.js'),
        {
          '../config/env': {
            cashfreePayoutMode: 'sandbox',
            cashfreePayoutClientId: 'cf-client',
            cashfreePayoutClientSecret: 'cf-secret',
            cashfreePayoutWebhookSecret: 'cf-secret',
            cashfreePayoutApiBaseUrl: 'https://sandbox.cashfree.com/payout',
            cashfreePayoutWebhookUrl: 'https://app.example/payout-webhook',
            cashfreePayoutBankEncryptionSecret: 'encrypt-secret'
          },
          '../models/Transporter': { findById: async () => null },
          '../models/Driver': { findById: async () => null },
          '../models/Customer': { findById: async () => null },
          '../models/PumpOwner': { findById: async () => null },
          '../models/CompanyUser': { findById: async () => null },
          '../models/PaymentSession': {},
          '../models/Payout': {
            findOne: async () => payoutDoc
          }
        }
      )

      const body = {
        transferId: 'TRF-1',
        status: 'SUCCESS',
        utr: 'UTR-123456'
      }
      const rawBody = JSON.stringify(body)
      const signature = require('node:crypto')
        .createHmac('sha256', 'cf-secret')
        .update(rawBody)
        .digest('hex')

      const payout = await service.handleCashfreePayoutWebhook({
        body,
        headers: {
          'x-webhook-signature': signature
        },
        rawBody
      })

      assert.equal(payout.status, 'SUCCESS')
      assert.equal(payout.cashfree.utr, 'UTR-123456')
      assert.ok(payout.completedAt instanceof Date)
    }
  }
]

module.exports = payoutTests
