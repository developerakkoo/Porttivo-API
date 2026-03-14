const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

test('reviewCashReceipt approves cashback and credits driver wallet', async () => {
  let creditCall = null;

  const transaction = {
    _id: 'fuel-1',
    transactionId: 'FTX-1',
    transactionType: 'CASH_RECEIPT',
    driverId: 'driver-1',
    transporterId: 'transporter-1',
    vehicleNumber: 'MH01AB1234',
    review: { status: 'PENDING' },
    cashback: { amount: 20, status: 'PENDING' },
    async save() {
      return this;
    },
    async populate() {
      return this;
    },
  };

  const controller = loadWithMocks('../src/controllers/fuelTransaction.controller.js', {
    '../models/FuelTransaction': {
      findById: async () => transaction,
    },
    '../models/FuelCard': {},
    '../models/Driver': {},
    '../models/Vehicle': {},
    '../services/qrCode.service': {
      generateQRCode: async () => ({}),
      validateQRCode: () => ({}),
      generateTransactionId: () => 'FTX-NEW',
    },
    '../services/fraudDetection.service': {
      runFraudChecks: async () => ({}),
    },
    '../middleware/upload.middleware': {
      upload: {},
    },
    '../services/walletLedger.service': {
      getOrCreateWallet: async () => ({}),
      debitWallet: async () => ({}),
      creditWallet: async (payload) => {
        creditCall = payload;
        return {
          transaction: { _id: 'wallet-tx-1' },
        };
      },
    },
  });

  const req = {
    params: { id: 'fuel-1' },
    body: { action: 'APPROVE', notes: 'Looks valid', creditCashback: true },
    user: { id: 'admin-1', userType: 'admin' },
  };
  const res = createMockRes();

  await controller.reviewCashReceipt(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(transaction.review.status, 'APPROVED');
  assert.equal(transaction.cashback.status, 'CREDITED');
  assert.equal(transaction.cashback.walletTransactionId, 'wallet-tx-1');
  assert.ok(transaction.cashback.creditedAt instanceof Date);
  assert.equal(creditCall.userId, 'driver-1');
  assert.equal(creditCall.userType, 'DRIVER');
  assert.equal(creditCall.amount, 20);
});
