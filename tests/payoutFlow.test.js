const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')

const payoutTests = [
  {
    name: 'registerBeneficiary stores Cashfree beneficiary details on the payee',
    async run() {
      const payeeDoc = {
        _id: 'payee-1',
        name: 'Alpha Logistics',
        email: 'alpha@example.com',
        mobile: '9999999999',
        cashfreeBeneId: null,
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

        assert.equal(result.beneId, 'TRANSPORTER_payee-1')
        assert.equal(payeeDoc.cashfreeBeneId, 'TRANSPORTER_payee-1')
        assert.equal(payeeDoc.cashfreeBeneficiary.status, 'ACTIVE')
        assert.ok(payeeDoc.cashfreeBeneficiary.bankAccountEncrypted)
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
        cashfreeBeneId: 'TRANSPORTER_payee-1',
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
        cashfreeBeneId: 'TRANSPORTER_payee-1',
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
