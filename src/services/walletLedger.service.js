const Wallet = require('../models/Wallet');
const WalletTransaction = require('../models/WalletTransaction');
const Transporter = require('../models/Transporter');
const Driver = require('../models/Driver');
const PumpOwner = require('../models/PumpOwner');
const FuelCard = require('../models/FuelCard');

const USER_MODEL_BY_TYPE = {
  TRANSPORTER: Transporter,
  DRIVER: Driver,
  PUMP_OWNER: PumpOwner,
};

const syncUserWalletMirror = async (wallet) => {
  const Model = USER_MODEL_BY_TYPE[wallet.userType];
  if (!Model) {
    return;
  }

  await Model.findByIdAndUpdate(wallet.userId, {
    $set: { walletBalance: wallet.balance },
  });
};

const syncTransporterFuelCardBalances = async (wallet) => {
  if (wallet.userType !== 'TRANSPORTER') {
    return;
  }

  await FuelCard.updateMany(
    { transporterId: wallet.userId },
    {
      $set: {
        balance: wallet.balance,
      },
    }
  );
};

const getOrCreateWallet = async ({ userId, userType, currency = 'INR' }) => {
  let wallet = await Wallet.findOne({ userId, userType });

  if (!wallet) {
    wallet = await Wallet.create({
      userId,
      userType,
      balance: 0,
      currency,
    });
  }

  return wallet;
};

const recordWalletTransaction = async ({
  walletId,
  type,
  amount,
  balanceBefore,
  balanceAfter,
  reference,
  referenceType,
  status = 'COMPLETED',
  description,
  metadata = {},
}) =>
  WalletTransaction.create({
    walletId,
    type,
    amount,
    balanceBefore,
    balanceAfter,
    reference,
    referenceType,
    status,
    description,
    metadata,
  });

const creditWallet = async ({
  userId,
  userType,
  amount,
  reference,
  referenceType,
  description,
  metadata = {},
}) => {
  const wallet = await getOrCreateWallet({ userId, userType });
  const balanceBefore = wallet.balance;
  await wallet.addBalance(amount);

  await syncUserWalletMirror(wallet);
  await syncTransporterFuelCardBalances(wallet);

  const transaction = await recordWalletTransaction({
    walletId: wallet._id,
    type: 'CREDIT',
    amount,
    balanceBefore,
    balanceAfter: wallet.balance,
    reference,
    referenceType,
    description,
    metadata,
  });

  return { wallet, transaction };
};

const debitWallet = async ({
  userId,
  userType,
  amount,
  reference,
  referenceType,
  description,
  metadata = {},
}) => {
  const wallet = await getOrCreateWallet({ userId, userType });
  if (!wallet.hasSufficientBalance(amount)) {
    throw new Error('Insufficient balance');
  }

  const balanceBefore = wallet.balance;
  await wallet.deductBalance(amount);

  await syncUserWalletMirror(wallet);
  await syncTransporterFuelCardBalances(wallet);

  const transaction = await recordWalletTransaction({
    walletId: wallet._id,
    type: 'DEBIT',
    amount,
    balanceBefore,
    balanceAfter: wallet.balance,
    reference,
    referenceType,
    description,
    metadata,
  });

  return { wallet, transaction };
};

module.exports = {
  getOrCreateWallet,
  recordWalletTransaction,
  creditWallet,
  debitWallet,
};
