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
      let payoutDoc = {
        _id: 'payout-1',
        payerId: 'payer-1',
        payeeId: 'payee-1',
        paymentId: 'payment-1',
        referenceType: 'INVOICE',
        referenceId: 'INV-1001',
        amount: 5000,
        currency: 'INR',
        provider: 'CASHFREE',
        cashfree: {
          beneId: 'TRANSPORTER_payee-1',
          transferId: null,
          transferMode: 'IMPS',
          beneficiary: {
            beneId: 'TRANSPORTER_payee-1',
            status: 'ACTIVE'
          },
          request: {},
          response: {}
        },
        status: 'CREATED',
        retry: { count: 0, maxRetry: 3, nextRetryAt: null },
        failure: {},
        async save() {
          return this
        }
      }

      const paymentDoc = {
        _id: 'payment-1',
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
          '../services/razorpayPayout.service': {
            createAutomaticPayoutForPayment: async () => ({
              ...payoutDoc,
              status: 'SUCCESS',
              cashfree: {
                ...(payoutDoc.cashfree || {}),
                transferId: 'TRF-1',
                utr: 'UTR-123456'
              }
            })
          },
          '../models/Payout': {
            findOne: async () => null,
            findOneAndUpdate: async (_query, update) => {
              payoutDoc = {
                ...payoutDoc,
                ...(update?.$set || {})
              }
              return payoutDoc
            },
            create: async ([doc]) => {
              payoutDoc = {
                ...payoutDoc,
                ...doc,
                save: async function save() {
                  return this
                }
              }
              return [payoutDoc]
            },
            countDocuments: async () => 0,
            findById: async () => payoutDoc
          }
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

        assert.equal(payout.status, 'SUCCESS')
        assert.equal(payout.cashfree.transferId, 'TRF-1')
        assert.equal(payout.cashfree.utr, 'UTR-123456')
      } finally {
        global.fetch = originalFetch
      }
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
      let payoutDoc = {
        _id: 'payout-403',
        payerId: 'payer-1',
        payeeId: 'payee-1',
        paymentId: 'payment-403',
        referenceType: 'INVOICE',
        referenceId: 'INV-403',
        amount: 5000,
        currency: 'INR',
        provider: 'CASHFREE',
        cashfree: {
          beneId: 'TRANSPORTER_payee-1',
          transferId: null,
          transferMode: 'IMPS',
          beneficiary: {
            beneId: 'TRANSPORTER_payee-1',
            status: 'ACTIVE'
          },
          request: {},
          response: {}
        },
        status: 'CREATED',
        retry: { count: 0, maxRetry: 3, nextRetryAt: null },
        failure: {},
        async save() {
          return this
        }
      }

      const paymentDoc = {
        _id: 'payment-403',
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
          '../services/razorpayPayout.service': {
            createAutomaticPayoutForPayment: async () => ({
              ...payoutDoc,
              status: 'FAILED',
              failure: {
                code: '403',
                message: 'The payout v1 and v1.2 APIs have been deprecated. Please use v2 APIs.'
              }
            })
          },
          '../models/Payout': {
            findOne: async () => null,
            findOneAndUpdate: async (_query, update) => {
              payoutDoc = {
                ...payoutDoc,
                ...(update?.$set || {})
              }
              return payoutDoc
            },
            create: async ([doc]) => {
              payoutDoc = {
                ...payoutDoc,
                ...doc,
                save: async function save() {
                  return this
                }
              }
              return [payoutDoc]
            },
            countDocuments: async () => 0,
            findById: async () => payoutDoc
          }
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
