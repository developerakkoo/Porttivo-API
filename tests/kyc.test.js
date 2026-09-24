const assert = require('assert');
const {
  validatePAN,
  normalizePAN,
  validateAadhaar,
  cleanAadhaar,
  validateIFSC
} = require('../src/utils/validation');
const Transporter = require('../src/models/Transporter');
const { requireTransporterKyc } = require('../src/middleware/auth.middleware');
const { formatDocUrl, checkBankDetailsStatus } = require('../src/controllers/transporterKyc.controller');

console.log('Running Transporter KYC Tests...\n');

// 1. Test PAN Validation
console.log('Test 1: PAN validation');
assert.strictEqual(validatePAN('ABCDE1234F'), true, 'Valid PAN should pass');
assert.strictEqual(validatePAN('abcde1234f'), true, 'Lowercase PAN should normalize and pass');
assert.strictEqual(validatePAN('ABCDE12345'), false, 'PAN with trailing digit should fail');
assert.strictEqual(validatePAN('ABCD1234F'), false, 'Short PAN should fail');
assert.strictEqual(validatePAN(''), false, 'Empty PAN should fail');
assert.strictEqual(normalizePAN('  abcde1234f  '), 'ABCDE1234F', 'Normalization should trim and uppercase');
console.log('✓ PAN validation passed\n');

// 2. Test Aadhaar Validation
console.log('Test 2: Aadhaar validation');
assert.strictEqual(validateAadhaar('123456789012'), true, 'Valid 12-digit Aadhaar should pass');
assert.strictEqual(validateAadhaar('1234 5678 9012'), true, 'Aadhaar with spaces should clean and pass');
assert.strictEqual(validateAadhaar('1234-5678-9012'), true, 'Aadhaar with hyphens should clean and pass');
assert.strictEqual(validateAadhaar('12345678901'), false, '11-digit Aadhaar should fail');
assert.strictEqual(validateAadhaar('1234567890123'), false, '13-digit Aadhaar should fail');
assert.strictEqual(validateAadhaar('abcdefghijkl'), false, 'Non-digit Aadhaar should fail');
assert.strictEqual(cleanAadhaar(' 1234-5678 9012 '), '123456789012', 'Clean Aadhaar should strip spaces and hyphens');
console.log('✓ Aadhaar validation passed\n');

// 3. Test IFSC Validation
console.log('Test 3: IFSC validation');
assert.strictEqual(validateIFSC('HDFC0001234'), true, 'Valid IFSC should pass');
assert.strictEqual(validateIFSC('SBIN0000001'), true, 'Valid SBI IFSC should pass');
assert.strictEqual(validateIFSC('HDFC1234567'), false, '5th char non-zero should fail');
assert.strictEqual(validateIFSC('HDF0001234'), false, 'Short IFSC should fail');
console.log('✓ IFSC validation passed\n');

// 4. Test Transporter Schema and isKycComplete method
console.log('Test 4: Transporter Model KYC methods');
const transporterPending = new Transporter({
  mobile: '9876543210',
  name: 'Test Transporter',
  kyc: {
    status: 'pending',
    isCompleted: false,
    panNumber: 'ABCDE1234F'
  }
});
assert.strictEqual(transporterPending.isKycComplete(), false, 'Pending KYC should return false');

const transporterCompleted = new Transporter({
  mobile: '9876543211',
  name: 'Completed Transporter',
  kyc: {
    status: 'completed',
    isCompleted: true,
    panNumber: 'ABCDE1234F',
    panImage: '/uploads/kyc/pan.jpg',
    aadhaarNumber: '123456789012',
    aadhaarImage: '/uploads/kyc/aadhaar.jpg'
  }
});
assert.strictEqual(transporterCompleted.isKycComplete(), true, 'Completed KYC should return true');
console.log('✓ Transporter Model KYC methods passed\n');

// 5. Test requireTransporterKyc Middleware
console.log('Test 5: requireTransporterKyc Middleware');
let blockedResponse = null;
const mockResBlocked = {
  status: function(code) {
    this.statusCode = code;
    return this;
  },
  json: function(payload) {
    blockedResponse = payload;
    return this;
  }
};

const mockReqBlocked = {
  user: {
    userType: 'transporter',
    userData: transporterPending
  }
};

let nextCalledBlocked = false;
requireTransporterKyc(mockReqBlocked, mockResBlocked, () => {
  nextCalledBlocked = true;
});

assert.strictEqual(nextCalledBlocked, false, 'Middleware should not call next for pending KYC');
assert.strictEqual(mockResBlocked.statusCode, 403, 'Middleware should return 403');
assert.strictEqual(blockedResponse.code, 'KYC_REQUIRED', 'Response code should be KYC_REQUIRED');
assert.strictEqual(
  blockedResponse.message,
  'KYC verification required. Please complete your KYC to access the network and marketplace.'
);

// Non-transporters (e.g. admin or customer) should pass through
let nextCalledAdmin = false;
requireTransporterKyc(
  { user: { userType: 'admin' } },
  mockResBlocked,
  () => { nextCalledAdmin = true; }
);
assert.strictEqual(nextCalledAdmin, true, 'Non-transporters should pass through');

// Completed transporter should pass through
let nextCalledCompleted = false;
requireTransporterKyc(
  { user: { userType: 'transporter', userData: transporterCompleted } },
  mockResBlocked,
  () => { nextCalledCompleted = true; }
);
assert.strictEqual(nextCalledCompleted, true, 'Completed transporter should pass through');
console.log('✓ requireTransporterKyc Middleware passed\n');

// 6. Test formatDocUrl and checkBankDetailsStatus
console.log('Test 6: Helper functions');
const mockReq = {
  protocol: 'https',
  get: () => 'api.porttivo.com'
};
assert.strictEqual(
  formatDocUrl(mockReq, '/uploads/kyc/doc.jpg'),
  'https://api.porttivo.com/uploads/kyc/doc.jpg',
  'formatDocUrl should prepend protocol and host'
);
assert.strictEqual(
  formatDocUrl(mockReq, 'https://cdn.porttivo.com/doc.jpg'),
  'https://cdn.porttivo.com/doc.jpg',
  'formatDocUrl should leave full URLs intact'
);

const bankCheck = checkBankDetailsStatus({
  cashfreeBeneficiary: {
    beneId: 'BENE_123',
    name: 'Transporter Ltd',
    bankAccountLast4: '4321'
  }
});
assert.strictEqual(bankCheck.isAdded, true, 'Bank details should be recognized from cashfreeBeneficiary');
assert.strictEqual(bankCheck.bankAccountLast4, '4321');
console.log('✓ Helper functions passed\n');

console.log('====================================');
console.log('ALL TRANSPORTER KYC TESTS PASSED! ✅');
console.log('====================================');

