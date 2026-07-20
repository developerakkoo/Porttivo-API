const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const payoutTests = [
  {
    name: 'createBeneficiary rejects transporter accounts for another payee',
    async run() {
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/payout.controller.js'),
        {
          '../services/cashfreePayout.service': {
            registerBeneficiary: async () => ({})
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
        assert.ok(payeeDoc.cashfreeBeneficiary.bankAccountEncrypted)
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
