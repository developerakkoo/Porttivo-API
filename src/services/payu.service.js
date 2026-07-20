const crypto = require('crypto')
const { nanoid } = require('nanoid')
const { payuKey, payuSalt, payuCheckoutUrl, payuMode, payuWebhookUrl } = require('../config/env')

const DEFAULT_PRODUCT_INFO = 'Marketplace Trip Payment'

const isConfigured = () => Boolean(payuKey && payuSalt && payuCheckoutUrl)

const normalizeMoney = (amount) => {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Valid payment amount is required')
  }
  return value.toFixed(2)
}

const makeTransactionId = () => {
  return `PTV-${nanoid(20)}`
}

const signRequest = ({
  key = payuKey,
  txnid,
  amount,
  productinfo = DEFAULT_PRODUCT_INFO,
  firstname,
  email,
  udf1 = '',
  udf2 = '',
  udf3 = '',
  udf4 = '',
  udf5 = ''
}) => {
  const hashString = [
    key,
    txnid,
    amount,
    productinfo,
    firstname,
    email,
    udf1 || '',
    udf2 || '',
    udf3 || '',
    udf4 || '',
    udf5 || '',
    '',
    '',
    '',
    '',
    '',
    payuSalt
  ].join('|')

  return crypto.createHash('sha512').update(hashString).digest('hex')
}

const signResponse = ({
  key = payuKey,
  txnid,
  amount,
  productinfo = DEFAULT_PRODUCT_INFO,
  firstname,
  email,
  status,
  udf1 = '',
  udf2 = '',
  udf3 = '',
  udf4 = '',
  udf5 = ''
}) => {
  const hashString = [
    payuSalt,
    status,
    '',
    '',
    '',
    '',
    '',
    udf5 || '',
    udf4 || '',
    udf3 || '',
    udf2 || '',
    udf1 || '',
    email,
    firstname,
    productinfo,
    amount,
    txnid,
    key
  ].join('|')

  return crypto.createHash('sha512').update(hashString).digest('hex')
}

const buildMarketplaceTripPaymentRequest = ({
  merchantTransactionId,
  amount,
  buyer,
  trip,
  booking,
  paymentId,
  successUrl,
  failureUrl
}) => {
  if (!isConfigured()) {
    throw new Error('PayU is not configured')
  }

  if (!buyer?.email) {
    throw new Error('Buyer email is required for PayU payment initiation')
  }

  const normalizedAmount = normalizeMoney(amount)
  const firstname = buyer.name || buyer.company || 'Marketplace Buyer'
  const productinfo = `Marketplace trip ${trip.tripId || trip._id}`
  const payload = {
    key: payuKey,
    txnid: merchantTransactionId || makeTransactionId(),
    amount: normalizedAmount,
    productinfo,
    firstname,
    email: buyer.email,
    phone: buyer.mobile || '',
    surl: successUrl || payuWebhookUrl,
    furl: failureUrl || payuWebhookUrl,
    udf1: paymentId ? String(paymentId) : '',
    udf2: trip?._id ? String(trip._id) : '',
    udf3: booking?._id ? String(booking._id) : '',
    udf4: buyer?._id ? String(buyer._id) : '',
    udf5: trip?.transporterId?._id ? String(trip.transporterId._id) : '',
    hash: '',
    service_provider: 'payu_paisa'
  }

  payload.hash = signRequest({
    txnid: payload.txnid,
    amount: payload.amount,
    productinfo,
    firstname,
    email: buyer.email,
    udf1: payload.udf1,
    udf2: payload.udf2,
    udf3: payload.udf3,
    udf4: payload.udf4,
    udf5: payload.udf5
  })

  return {
    actionUrl: payuCheckoutUrl,
    method: 'POST',
    provider: 'PAYU',
    mode: payuMode,
    fields: payload
  }
}

const verifyPayuResponseHash = (body) => {
  if (!body || typeof body !== 'object') {
    return false
  }

  const receivedHash = String(body.hash || '').trim().toLowerCase()
  if (!receivedHash) {
    return false
  }

  const computedHash = signResponse({
    txnid: body.txnid || body.txnid?.toString?.() || '',
    amount: String(body.amount || ''),
    productinfo: body.productinfo || DEFAULT_PRODUCT_INFO,
    firstname: body.firstname || '',
    email: body.email || '',
    status: String(body.status || '').toLowerCase(),
    udf1: body.udf1 || '',
    udf2: body.udf2 || '',
    udf3: body.udf3 || '',
    udf4: body.udf4 || '',
    udf5: body.udf5 || ''
  })

  return receivedHash === computedHash.toLowerCase()
}

const normalizePayuStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'success') return 'SUCCESS'
  if (normalized === 'failure') return 'FAILED'
  if (normalized === 'cancel' || normalized === 'cancelled') return 'CANCELLED'
  if (normalized === 'pending') return 'PENDING'
  return 'PENDING'
}

module.exports = {
  DEFAULT_PRODUCT_INFO,
  isConfigured,
  makeTransactionId,
  buildMarketplaceTripPaymentRequest,
  normalizeMoney,
  verifyPayuResponseHash,
  normalizePayuStatus
}
