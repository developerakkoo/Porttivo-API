const assert = require('node:assert/strict')
const path = require('node:path')
const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')
const kycService = require('../src/services/kyc.service')

const kycTests = [
  {
    name: 'KYC completion requires PAN number, PAN image, Aadhaar number and Aadhaar image',
    run() {
      assert.equal(
        kycService.hasRequiredDocuments({
          panNumber: 'ABCDE1234F',
          panImagePath: '/uploads/kyc/pan.jpg',
          aadhaarNumber: '123456789012',
          aadhaarImagePath: '/uploads/kyc/aadhaar.jpg'
        }),
        true
      )
      assert.equal(
        kycService.hasRequiredDocuments({
          panNumber: 'ABCDE1234F',
          panImagePath: '/uploads/kyc/pan.jpg',
          aadhaarNumber: '123456789012'
        }),
        false
      )
    }
  },
  {
    name: 'KYC completion does not require bank details',
    run() {
      const transporter = { hasAccess: false, kyc: {} }
      const kyc = kycService.ensureKyc(transporter)
      const errors = kycService.applyKycInput(kyc, {
        body: {
          panNumber: 'ABCDE1234F',
          panImage: '/uploads/kyc/pan.jpg',
          aadhaarNumber: '123456789012',
          aadhaarImage: '/uploads/kyc/aadhaar.jpg'
        }
      })
      assert.deepEqual(errors, [])
      const completed = kycService.applyCompletionState(transporter, kyc)
      assert.equal(completed, true)
      assert.equal(kyc.status, 'completed')
      assert.equal(kyc.isCompleted, true)
      assert.equal(transporter.hasAccess, true)
    }
  },
  {
    name: 'invalid PAN and Aadhaar numbers are rejected',
    run() {
      assert.equal(
        kycService.validatePanNumber('ABCDE1234').error,
        'Enter a valid 10-character PAN number'
      )
      assert.equal(
        kycService.validateAadhaarNumber('1234 5678').error,
        'Enter a valid 12-digit Aadhaar number'
      )
      assert.equal(kycService.validatePanNumber('ABCDE1234F').value, 'ABCDE1234F')
      assert.equal(
        kycService.validateAadhaarNumber('1234 5678 9012').value,
        '123456789012'
      )
    }
  },
  {
    name: 'Razorpay beneficiary is exposed as bankDetails.isAdded without completing KYC',
    run() {
      const kyc = kycService.emptyKyc()
      const bank = kycService.resolveBankDetails(
        {
          name: 'Transporter Name',
          razorpayBeneficiary: {
            fundAccountId: 'fa_1',
            bankAccountLast4: '4321'
          }
        },
        kyc
      )
      assert.equal(bank.isAdded, true)
      assert.equal(bank.bankAccountLast4, '4321')
      assert.equal(bank.source, 'razorpay')
      assert.equal(kycService.hasRequiredDocuments(kyc), false)
    }
  },
  {
    name: 'GET KYC serializes public image URLs and pending status',
    run() {
      const payload = kycService.serializeKyc(
        {
          hasAccess: true,
          kyc: {
            status: 'pending',
            isCompleted: false,
            panNumber: 'ABCDE1234F',
            panImagePath: '/uploads/kyc/pan.jpg'
          }
        },
        {
          protocol: 'https',
          headers: { host: 'api.example.com' },
          get: (name) => (name === 'host' ? 'api.example.com' : null)
        }
      )
      assert.equal(payload.status, 'pending')
      assert.equal(payload.isCompleted, false)
      assert.equal(
        payload.panImage,
        'https://api.example.com/uploads/kyc/pan.jpg'
      )
      assert.equal(payload.networkAccessGranted, false)
    }
  },
  {
    name: 'upsert KYC JSON completes access when required documents exist',
    async run() {
      const transporter = {
        _id: 't-1',
        hasAccess: false,
        kyc: {},
        async save() {
          return this
        }
      }
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/kyc.controller.js'),
        {
          '../models/Transporter': {
            findById: async () => transporter
          },
          '../utils/cache': {
            deleteCache: async () => true,
            deleteCachePattern: async () => true
          },
          '../utils/logger': { info: () => {} }
        }
      )

      const req = {
        user: { id: 't-1' },
        protocol: 'https',
        headers: { host: 'api.example.com' },
        get: (name) => (name === 'host' ? 'api.example.com' : null),
        body: {
          panNumber: 'ABCDE1234F',
          panImage: 'https://api.example.com/uploads/kyc/pan.jpg',
          aadhaarNumber: '123456789012',
          aadhaarImage: 'https://api.example.com/uploads/kyc/aadhaar.jpg'
        }
      }
      const res = createMockRes()
      await controller.upsertKyc(req, res, (error) => {
        throw error
      })

      assert.equal(res.statusCode, 200)
      assert.equal(res.body.success, true)
      assert.equal(res.body.data.kyc.isCompleted, true)
      assert.equal(res.body.data.kyc.networkAccessGranted, true)
      assert.match(res.body.message, /network and marketplace/)
      assert.equal(transporter.hasAccess, true)
    }
  },
  {
    name: 'requireTransporterKyc returns KYC_REQUIRED for incomplete transporters',
    async run() {
      const middleware = loadWithMocks(
        path.resolve(process.cwd(), 'src/middleware/kyc.middleware.js'),
        {
          '../models/Transporter': {
            findById: async () => ({
              kyc: { status: 'pending', isCompleted: false }
            })
          }
        }
      )
      const req = {
        user: {
          id: 't-1',
          userType: 'transporter',
          userData: { kyc: { status: 'pending', isCompleted: false } }
        }
      }
      const res = createMockRes()
      let nextCalled = false
      await middleware.requireTransporterKyc(req, res, () => {
        nextCalled = true
      })
      assert.equal(nextCalled, false)
      assert.equal(res.statusCode, 403)
      assert.equal(res.body.code, 'KYC_REQUIRED')
      assert.equal(res.body.data.isKycCompleted, false)
    }
  },
  {
    name: 'requireTransporterKyc allows completed transporters and non-transporters',
    async run() {
      const middleware = loadWithMocks(
        path.resolve(process.cwd(), 'src/middleware/kyc.middleware.js'),
        {
          '../models/Transporter': { findById: async () => null }
        }
      )

      const completedReq = {
        user: {
          id: 't-1',
          userType: 'transporter',
          userData: { kyc: { status: 'completed', isCompleted: true } }
        }
      }
      const completedRes = createMockRes()
      let completedNext = false
      await middleware.requireTransporterKyc(completedReq, completedRes, () => {
        completedNext = true
      })
      assert.equal(completedNext, true)

      const adminReq = { user: { id: 'a-1', userType: 'admin' } }
      const adminRes = createMockRes()
      let adminNext = false
      await middleware.requireTransporterKyc(adminReq, adminRes, () => {
        adminNext = true
      })
      assert.equal(adminNext, true)
    }
  },
  {
    name: 'admin KYC review can complete or reject transporter access',
    async run() {
      const transporter = {
        _id: 't-1',
        hasAccess: false,
        kyc: kycService.emptyKyc(),
        async save() {
          return this
        }
      }
      const controller = loadWithMocks(
        path.resolve(process.cwd(), 'src/controllers/kyc.controller.js'),
        {
          '../models/Transporter': {
            findById: async () => transporter
          },
          '../utils/cache': {
            deleteCache: async () => true,
            deleteCachePattern: async () => true
          },
          '../utils/logger': { info: () => {} }
        }
      )

      const req = {
        params: { id: 't-1' },
        body: { status: 'completed', adminNotes: 'Documents checked', hasAccess: true },
        protocol: 'https',
        headers: { host: 'api.example.com' },
        get: () => 'api.example.com'
      }
      const res = createMockRes()
      await controller.reviewTransporterKyc(req, res, (error) => {
        throw error
      })
      assert.equal(res.statusCode, 200)
      assert.equal(transporter.kyc.status, 'completed')
      assert.equal(transporter.kyc.adminReviewed, true)
      assert.equal(transporter.hasAccess, true)
    }
  }
]

module.exports = kycTests
