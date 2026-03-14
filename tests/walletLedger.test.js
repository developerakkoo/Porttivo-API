const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithMocks } = require('./helpers/loadWithMocks');

test('debitWallet deducts balance, mirrors wallet, and syncs transporter fuel cards', async () => {
  const calls = {
    transporterUpdate: null,
    fuelCardUpdate: null,
    walletTransaction: null,
  };

  const wallet = {
    _id: 'wallet-1',
    userId: 'transporter-1',
    userType: 'TRANSPORTER',
    balance: 1000,
    hasSufficientBalance(amount) {
      return this.balance >= amount;
    },
    async deductBalance(amount) {
      this.balance -= amount;
      return this;
    },
  };

  const service = loadWithMocks('../src/services/walletLedger.service.js', {
    '../models/Wallet': {
      findOne: async () => wallet,
      create: async () => wallet,
    },
    '../models/WalletTransaction': {
      create: async (payload) => {
        calls.walletTransaction = payload;
        return payload;
      },
    },
    '../models/Transporter': {
      findByIdAndUpdate: async (id, update) => {
        calls.transporterUpdate = { id, update };
      },
    },
    '../models/Driver': {
      findByIdAndUpdate: async () => {},
    },
    '../models/PumpOwner': {
      findByIdAndUpdate: async () => {},
    },
    '../models/FuelCard': {
      updateMany: async (query, update) => {
        calls.fuelCardUpdate = { query, update };
      },
    },
  });

  const result = await service.debitWallet({
    userId: 'transporter-1',
    userType: 'TRANSPORTER',
    amount: 250,
    reference: 'FTX-1',
    referenceType: 'FUEL',
    description: 'Fuel purchase',
  });

  assert.equal(result.wallet.balance, 750);
  assert.equal(calls.transporterUpdate.id, 'transporter-1');
  assert.deepEqual(calls.transporterUpdate.update, { $set: { walletBalance: 750 } });
  assert.deepEqual(calls.fuelCardUpdate.query, { transporterId: 'transporter-1' });
  assert.equal(calls.fuelCardUpdate.update.$set.balance, 750);
  assert.equal(calls.walletTransaction.type, 'DEBIT');
  assert.equal(calls.walletTransaction.balanceAfter, 750);
});
