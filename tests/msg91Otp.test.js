const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

const msg91Service = require('../src/services/msg91.service');

test('msg91Service formats 10-digit Indian mobile numbers with country code', () => {
  assert.equal(msg91Service.formatMobileWithCountryCode('9403884093'), '919403884093');
  assert.equal(msg91Service.formatMobileWithCountryCode('919403884093'), '919403884093');
  assert.equal(msg91Service.formatMobileWithCountryCode(''), '');
});

test('msg91Service handles test mode bypass correctly', async () => {
  const env = require('../src/config/env');
  const originalEnableTest = env.msg91EnableTestOtp;
  const originalTestOtp = env.msg91TestOtp;

  env.msg91EnableTestOtp = true;
  env.msg91TestOtp = '123456';

  const sendRes = await msg91Service.sendOtp('9403884093');
  assert.equal(sendRes.success, true);
  assert.equal(sendRes.isTestMode, true);

  const verifyResSuccess = await msg91Service.verifyOtp('9403884093', '123456');
  assert.equal(verifyResSuccess.success, true);

  const resendRes = await msg91Service.resendOtp('9403884093', 'text');
  assert.equal(resendRes.success, true);

  env.msg91EnableTestOtp = originalEnableTest;
  env.msg91TestOtp = originalTestOtp;
});

test('sendOTP controller sends OTP for valid registered transporter', async () => {
  const mockTransporter = {
    _id: 'transporter-123',
    mobile: '9403884093',
    name: 'Test Transporter',
    email: 'transporter@test.com',
    company: 'Test Logistics',
    operatingCountry: 'IN',
    status: 'active',
    hasAccess: true,
    hasPinSet: () => false,
  };

  let sendOtpCalledWith = null;

  const authController = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/auth.controller.js'), {
    '../models/Transporter': {
      findOne: async (query) => {
        if (query.mobile === '9403884093') return mockTransporter;
        return null;
      },
    },
    '../models/Driver': { findOne: async () => null },
    '../models/PumpOwner': { findOne: async () => null },
    '../models/PumpStaff': { findOne: async () => null },
    '../models/Customer': { findOne: async () => null },
    '../services/msg91.service': {
      sendOtp: async (mobile) => {
        sendOtpCalledWith = mobile;
        return { success: true, message: 'OTP sent successfully', requestId: 'req_123' };
      },
      verifyOtp: async () => ({ success: true, message: 'Verified' }),
      resendOtp: async () => ({ success: true, message: 'Resent' }),
    },
  });

  const req = {
    body: {
      mobile: '9403884093',
      userType: 'transporter',
    },
  };
  const res = createMockRes();

  await authController.sendOTP(req, res, (err) => { throw err; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, 'OTP sent successfully');
  assert.equal(sendOtpCalledWith, '9403884093');
});

test('sendOTP controller rejects unregistered driver with 404', async () => {
  const authController = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/auth.controller.js'), {
    '../models/Driver': { findOne: async () => null },
    '../models/Transporter': { findOne: async () => null },
    '../models/PumpOwner': { findOne: async () => null },
    '../models/PumpStaff': { findOne: async () => null },
    '../models/Customer': { findOne: async () => null },
    '../services/msg91.service': {
      sendOtp: async () => {
        assert.fail('sendOtp should not be called for unregistered user');
      },
    },
  });

  const req = {
    body: {
      mobile: '9999999999',
      userType: 'driver',
    },
  };
  const res = createMockRes();

  await authController.sendOTP(req, res, (err) => { throw err; });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /not linked/i);
});

test('sendOTP controller rejects blocked transporter with 403', async () => {
  const authController = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/auth.controller.js'), {
    '../models/Transporter': {
      findOne: async () => ({ status: 'blocked' }),
    },
    '../models/Driver': { findOne: async () => null },
    '../models/PumpOwner': { findOne: async () => null },
    '../models/PumpStaff': { findOne: async () => null },
    '../models/Customer': { findOne: async () => null },
    '../services/msg91.service': {
      sendOtp: async () => {
        assert.fail('sendOtp should not be called for blocked user');
      },
    },
  });

  const req = {
    body: {
      mobile: '9403884093',
      userType: 'transporter',
    },
  };
  const res = createMockRes();

  await authController.sendOTP(req, res, (err) => { throw err; });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
  assert.match(res.body.message, /blocked/i);
});

test('verifyOTP controller verifies OTP and returns JWT tokens for driver', async () => {
  const mockDriver = {
    _id: 'driver-123',
    mobile: '9403884093',
    name: 'Driver Joe',
    status: 'active',
    language: 'en',
    transporterId: 'transporter-1',
    save: async () => mockDriver,
  };

  const authController = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/auth.controller.js'), {
    '../models/Driver': { findOne: async () => mockDriver },
    '../models/Transporter': { findOne: async () => null },
    '../models/PumpOwner': { findOne: async () => null },
    '../models/PumpStaff': { findOne: async () => null },
    '../models/Customer': { findOne: async () => null },
    '../services/msg91.service': {
      sendOtp: async () => ({ success: true }),
      verifyOtp: async (mobile, otp) => {
        if (otp === '3729') return { success: true, message: 'OTP verified success' };
        return { success: false, message: 'Invalid or expired OTP' };
      },
      resendOtp: async () => ({ success: true }),
    },
  });

  // Test with invalid OTP
  const reqBad = {
    body: {
      mobile: '9403884093',
      userType: 'driver',
      otp: '0000',
    },
  };
  const resBad = createMockRes();
  await authController.verifyOTP(reqBad, resBad, (err) => { throw err; });

  assert.equal(resBad.statusCode, 400);
  assert.equal(resBad.body.success, false);
  assert.match(resBad.body.message, /Invalid or expired OTP/i);

  // Test with valid OTP
  const reqGood = {
    body: {
      mobile: '9403884093',
      userType: 'driver',
      otp: '3729',
    },
  };
  const resGood = createMockRes();
  await authController.verifyOTP(reqGood, resGood, (err) => { throw err; });

  assert.equal(resGood.statusCode, 200);
  assert.equal(resGood.body.success, true);
  assert.ok(resGood.body.data.accessToken);
  assert.ok(resGood.body.data.refreshToken);
  assert.equal(resGood.body.data.user.id, 'driver-123');
  assert.equal(resGood.body.data.user.userType, 'driver');
});

test('resendOTP controller calls MSG91 retry endpoint', async () => {
  let retryTypeUsed = null;

  const authController = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/auth.controller.js'), {
    '../models/Transporter': {
      findOne: async () => ({ _id: 'trans-1', mobile: '9403884093', status: 'active' }),
    },
    '../models/Driver': { findOne: async () => null },
    '../models/PumpOwner': { findOne: async () => null },
    '../models/PumpStaff': { findOne: async () => null },
    '../models/Customer': { findOne: async () => null },
    '../services/msg91.service': {
      sendOtp: async () => ({ success: true }),
      verifyOtp: async () => ({ success: true }),
      resendOtp: async (mobile, retryType) => {
        retryTypeUsed = retryType;
        return { success: true, message: 'OTP resent successfully' };
      },
    },
  });

  const req = {
    body: {
      mobile: '9403884093',
      userType: 'transporter',
      retryType: 'voice',
    },
  };
  const res = createMockRes();

  await authController.resendOTP(req, res, (err) => { throw err; });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(retryTypeUsed, 'voice');
});

