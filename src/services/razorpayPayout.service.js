const crypto = require('crypto')
const mongoose = require('mongoose')
const logger = require('../utils/logger')
const Payout = require('../models/Payout')
const PaymentSession = require('../models/PaymentSession')
const Transporter = require('../models/Transporter')
const Driver = require('../models/Driver')
const Customer = require('../models/Customer')
const PumpOwner = require('../models/PumpOwner')
const CompanyUser = require('../models/CompanyUser')
const {
  razorpayPayoutAccountNumber,
  razorpayPayoutApiBaseUrl,
  razorpayPayoutKeyId,
  razorpayPayoutKeySecret,
  razorpayPayoutWebhookSecret,
  razorpayPayoutWebhookUrl,
  razorpayPayoutMode
} = require('../config/env')

const PAYEE_MODELS = [
  { modelName: 'TRANSPORTER', Model: Transporter },
  { modelName: 'DRIVER', Model: Driver },
  { modelName: 'CUSTOMER', Model: Customer },
  { modelName: 'PUMP_OWNER', Model: PumpOwner },
  { modelName: 'COMPANY_USER', Model: CompanyUser }
]

const RETRY_DELAYS_MS = [15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000]
const STALE_PROCESSING_WINDOW_MS = 10 * 60 * 1000

const safeObjectIdString = value => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString ? value.toString() : String(value)
}

const normalizeMoney = amount => {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Valid payout amount is required')
  }
  return Number(value.toFixed(2))
}

const normalizeIntegerAmount = amount =>
  Math.round(Number(normalizeMoney(amount)) * 100)

const extractAccountLast4 = value => {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(-4)
}

const makeTransferId = (prefix = 'RZP') => {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
  }

  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(6)
    .toString('hex')
    .toUpperCase()}`
}

const makeIdempotencyKey = payoutId =>
  `RZP-${String(payoutId || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48)}`

const savePayoutWithLogs = async payout => {
  console.log('Saving payout...')
  console.log({
    payoutId: payout?.razorpay?.payoutId || null,
    status: payout?.status || null
  })
  return payout.save()
}

const sanitizeResponse = payload => {
  if (!payload || typeof payload !== 'object') {
    return payload || {}
  }

  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload }
  for (const key of ['bank_account_number', 'bank_ifsc', 'account_number']) {
    delete sanitized[key]
  }

  for (const nestedKey of ['data', 'raw', 'payload']) {
    if (sanitized[nestedKey] && typeof sanitized[nestedKey] === 'object') {
      sanitized[nestedKey] = sanitizeResponse(sanitized[nestedKey])
    }
  }

  return sanitized
}

const buildRequestHeaders = (extraHeaders = {}) => {
  const auth = Buffer.from(
    `${razorpayPayoutKeyId}:${razorpayPayoutKeySecret}`
  ).toString('base64')

  return {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    ...extraHeaders
  }
}

const getFetchImpl = () => {
  if (typeof global.fetch === 'function') {
    return global.fetch
  }

  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch
  }

  try {
    return require('undici').fetch
  } catch (error) {
    return null
  }
}

const razorpayRequest = async (
  path,
  {
    method = 'GET',
    body = null,
    headers = {},
    query = null,
    fetchImpl = getFetchImpl()
  } = {}
) => {
  const resolvedFetchImpl =
    typeof fetchImpl === 'function' ? fetchImpl : getFetchImpl()
  if (typeof resolvedFetchImpl !== 'function') {
    throw new Error('Fetch is not available for Razorpay payout requests')
  }

  const url = new URL(`${razorpayPayoutApiBaseUrl}${path}`)
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const response = await resolvedFetchImpl(url.toString(), {
    method,
    headers: buildRequestHeaders(headers),
    body: body ? JSON.stringify(body) : undefined
  })

  const rawText = await response.text()
  let data = {}
  try {
    data = rawText ? JSON.parse(rawText) : {}
  } catch (error) {
    data = { raw: rawText }
  }

  return {
    ok: response.ok,
    status: response.status,
    data
  }
}

const findPayeeRecordById = async payeeId => {
  const id = safeObjectIdString(payeeId)
  if (!id) {
    return { payee: null, modelName: null }
  }

  for (const entry of PAYEE_MODELS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const payee = await entry.Model.findById(id)
      if (payee) {
        return { payee, modelName: entry.modelName }
      }
    } catch (error) {
      continue
    }
  }

  return { payee: null, modelName: null }
}

const getPayeeSnapshot = (payee, modelName) => {
  if (!payee) return null

  const userType = modelName || payee.constructor?.modelName || null
  return {
    userId: safeObjectIdString(payee._id),
    userType,
    name: payee.name || payee.company || payee.pumpName || null,
    email: payee.email || null,
    mobile: payee.mobile || null
  }
}

const normalizeRazorpayContactType = type => {
  const normalized = String(type || '')
    .trim()
    .toLowerCase()
  if (!normalized) {
    return 'customer'
  }

  const aliases = {
    vendor: 'vendor',
    supplier: 'vendor',
    customer: 'customer',
    employee: 'employee',
    merchant: 'merchant',
    sub_merchant: 'sub_merchant',
    submerchant: 'sub_merchant'
  }

  return aliases[normalized] || normalized
}

const normalizeRazorpayPayoutStatus = status => {
  const normalized = String(status || '')
    .trim()
    .toLowerCase()
  if (
    [
      'captured',
      'paid',
      'processed',
      'payout.processed',
      'success',
      'completed',
      'succeeded',
      'payout.success'
    ].includes(normalized)
  ) {
    return 'SUCCESS'
  }
  if (
    [
      'failed',
      'failure',
      'reversed',
      'rejected',
      'payout.failed',
      'payout.reversed',
      'payout.rejected'
    ].includes(normalized)
  ) {
    return 'FAILED'
  }
  if (['retry_pending', 'retry-pending', 'payout.retry_pending'].includes(normalized)) {
    return 'RETRY_PENDING'
  }
  if (['cancelled', 'canceled', 'payout.cancelled', 'payout.canceled'].includes(normalized)) {
    return 'CANCELLED'
  }
  if (
    [
      'created',
      'payout.created'
    ].includes(normalized)
  ) {
    return 'CREATED'
  }
  if (
    [
      'processing',
      'queued',
      'pending',
      'initiated',
      'updated',
      'payout.queued',
      'payout.pending',
      'payout.initiated',
      'payout.updated'
    ].includes(normalized)
  ) {
    return 'PROCESSING'
  }
  return 'PROCESSING'
}

const getRazorpayPayoutStatusRank = status => {
  const normalized = normalizeRazorpayPayoutStatus(status)
  const ranks = {
    CREATED: 1,
    PROCESSING: 2,
    RETRY_PENDING: 3,
    FAILED: 4,
    CANCELLED: 5,
    SUCCESS: 6
  }

  return ranks[normalized] || 0
}

const shouldApplyRazorpayPayoutStatusUpdate = (currentStatus, nextStatus) => {
  const current = normalizeRazorpayPayoutStatus(currentStatus)
  const next = normalizeRazorpayPayoutStatus(nextStatus)

  if (!next) {
    return false
  }

  if (current === 'CANCELLED') {
    return next === 'CANCELLED'
  }

  if (current === 'SUCCESS') {
    return next === 'SUCCESS'
  }

  if (current === 'FAILED') {
    return next === 'FAILED' || next === 'SUCCESS'
  }

  return getRazorpayPayoutStatusRank(next) >= getRazorpayPayoutStatusRank(current)
}

const extractRazorpayMessage = payload => {
  if (!payload || typeof payload === 'undefined') {
    return null
  }

  if (typeof payload === 'string') {
    return payload.trim() || null
  }

  if (payload instanceof Error) {
    return payload.message || null
  }

  if (typeof payload === 'object') {
    if (typeof payload.message === 'string' && payload.message.trim()) {
      return payload.message.trim()
    }

    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim()
    }

    if (payload.error && typeof payload.error === 'object') {
      const nestedMessage =
        payload.error.description ||
        payload.error.message ||
        payload.error.error_description
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return nestedMessage.trim()
      }
    }

    if (
      payload.description &&
      typeof payload.description === 'string' &&
      payload.description.trim()
    ) {
      return payload.description.trim()
    }
  }

  return null
}

const parseRazorpayResponse = payload => {
  if (!payload) {
    return { raw: payload, status: null }
  }

  if (typeof payload === 'string') {
    try {
      return parseRazorpayResponse(JSON.parse(payload))
    } catch (error) {
      return { raw: payload, status: null }
    }
  }

  const data =
    payload.data && typeof payload.data === 'object' ? payload.data : payload
  const status = String(
    data.status ||
      data.payout_status ||
      data.transfer_status ||
      data.state ||
      data.event ||
      ''
  )
    .trim()
    .toUpperCase()

  return {
    raw: payload,
    data,
    status,
    payoutId: data.id || data.payout_id || data.reference_id || null,
    contactId: data.contact_id || data.contactId || null,
    fundAccountId: data.fund_account_id || data.fundAccountId || null,
    utr: data.utr || data.utr_no || data.utrNo || null,
    code: data.code || data.error_code || null,
    message:
      extractRazorpayMessage(
        data.message || data.error || data.errorMessage || data
      ) || null,
    statusDetails: data.status_details || data.statusDetails || null
  }
}

const buildPayoutFailure = ({ code, message, reason, isRetryable }) => ({
  code: code || null,
  message: message || reason || null,
  reason: reason || message || null,
  isRetryable: Boolean(isRetryable)
})

const summarizePayee = payee => {
  if (!payee) return null
  return {
    id: payee._id ? payee._id.toString() : null,
    model: payee.constructor?.modelName || payee.userType || null,
    name: payee.name || payee.company || payee.pumpName || null,
    email: payee.email || null,
    mobile: payee.mobile || null
  }
}

const ensureRazorpayBeneficiaryPayload = ({
  payee,
  payeeId,
  name,
  email,
  phone,
  bankAccount,
  ifsc,
  accountType = 'bank_account'
} = {}) => {
  const contactName = String(
    name || payee?.name || payee?.company || payee?.pumpName || ''
  ).trim()
  const contactEmail = String(email || payee?.email || '')
    .trim()
    .toLowerCase()
  const contactPhone = String(phone || payee?.mobile || '').trim()
  const accountNumber = String(bankAccount || '').trim()
  const accountIfsc = String(ifsc || '')
    .trim()
    .toUpperCase()

  if (!contactName || !contactPhone || !accountNumber || !accountIfsc) {
    const error = new Error(
      'name, phone, bankAccount, and ifsc are required for Razorpay beneficiary sync'
    )
    error.statusCode = 400
    throw error
  }

  return {
    contact: {
      name: contactName,
      email: contactEmail || undefined,
      contact: contactPhone,
      type: normalizeRazorpayContactType(
        String(
          payee?.constructor?.modelName || payee?.userType || 'beneficiary'
        ).trim()
      ),
      reference_id: String(payeeId || payee?._id || '').trim() || undefined
    },
    fundAccount: {
      account_type: accountType,
      bank_account: {
        name: contactName,
        ifsc: accountIfsc,
        account_number: accountNumber
      }
    }
  }
}

const createRazorpayContact = async (contact, fetchImpl = getFetchImpl()) => {
  const normalizedContact = {
    ...(contact || {}),
    type: normalizeRazorpayContactType(contact?.type)
  }

  const result = await razorpayRequest('/contacts', {
    method: 'POST',
    body: normalizedContact,
    fetchImpl
  })

  const parsed = parseRazorpayResponse(result.data)
  if (!result.ok) {
    const message =
      parsed.message ||
      result.data?.error_description ||
      result.data?.error ||
      `Razorpay contact creation failed with status ${result.status}`
    throw new Error(message)
  }

  return parsed
}

const createRazorpayFundAccount = async (
  { contactId, accountType = 'bank_account', bankAccount },
  fetchImpl = getFetchImpl()
) => {
  const result = await razorpayRequest('/fund_accounts', {
    method: 'POST',
    body: {
      contact_id: contactId,
      account_type: accountType,
      bank_account: bankAccount
    },
    fetchImpl
  })

  const parsed = parseRazorpayResponse(result.data)
  if (!result.ok) {
    const message =
      parsed.message ||
      result.data?.error_description ||
      result.data?.error ||
      `Razorpay fund account creation failed with status ${result.status}`
    throw new Error(message)
  }

  return parsed
}

const updatePayeeRazorpayBeneficiary = async ({
  payee,
  modelName,
  contactId,
  fundAccountId,
  beneficiaryResponse,
  bankAccountNumber,
  accountType = 'bank_account'
}) => {
  const now = new Date()
  payee.razorpayBeneficiary = {
    contactId,
    fundAccountId,
    status: 'ACTIVE',
    bankAccountLast4: extractAccountLast4(bankAccountNumber),
    accountType,
    referenceId: String(payee._id || '').trim() || null,
    providerResponse: sanitizeResponse(beneficiaryResponse || {}),
    verifiedAt: now,
    createdAt: payee.razorpayBeneficiary?.createdAt || now,
    updatedAt: now
  }

  await payee.save()
  return {
    payee,
    modelName
  }
}

const patchPayeeRazorpayBeneficiary = async ({
  payee,
  contactId,
  fundAccountId,
  bankAccountNumber,
  accountType,
  providerResponse
} = {}) => {
  const now = new Date()

  payee.razorpayBeneficiary = {
    contactId: contactId || payee.razorpayBeneficiary?.contactId || null,
    fundAccountId:
      fundAccountId || payee.razorpayBeneficiary?.fundAccountId || null,
    status: 'ACTIVE',
    bankAccountLast4:
      bankAccountNumber !== undefined
        ? extractAccountLast4(bankAccountNumber)
        : payee.razorpayBeneficiary?.bankAccountLast4 || null,
    accountType:
      accountType || payee.razorpayBeneficiary?.accountType || 'bank_account',
    referenceId:
      String(payee._id || '').trim() ||
      payee.razorpayBeneficiary?.referenceId ||
      null,
    providerResponse: sanitizeResponse({
      ...(payee.razorpayBeneficiary?.providerResponse || {}),
      ...(providerResponse || {})
    }),
    verifiedAt: now,
    createdAt: payee.razorpayBeneficiary?.createdAt || now,
    updatedAt: now
  }

  await payee.save()
  return {
    payee,
    modelName: payee.constructor?.modelName || null
  }
}

const syncRazorpayBeneficiaryForPayee = async (
  {
    payeeId,
    name,
    email,
    phone,
    bankAccount,
    ifsc,
    accountType = 'bank_account'
  } = {},
  fetchImpl = getFetchImpl()
) => {
  const { payee, modelName } = await findPayeeRecordById(payeeId)
  if (!payee) {
    const error = new Error('Payee not found')
    error.statusCode = 404
    throw error
  }

  const payload = ensureRazorpayBeneficiaryPayload({
    payee,
    payeeId,
    name,
    email,
    phone,
    bankAccount,
    ifsc,
    accountType
  })

  const contactResponse = await createRazorpayContact(
    payload.contact,
    fetchImpl
  )
  const contactId =
    contactResponse.data?.id || contactResponse.contactId || null
  if (!contactId) {
    throw new Error('Razorpay contact id not returned by provider')
  }

  const fundAccountResponse = await createRazorpayFundAccount(
    {
      contactId,
      accountType,
      bankAccount: payload.fundAccount.bank_account
    },
    fetchImpl
  )
  const fundAccountId =
    fundAccountResponse.data?.id || fundAccountResponse.fundAccountId || null
  if (!fundAccountId) {
    throw new Error('Razorpay fund account id not returned by provider')
  }

  const updated = await updatePayeeRazorpayBeneficiary({
    payee,
    modelName,
    contactId,
    fundAccountId,
    beneficiaryResponse: {
      contact: contactResponse.raw || contactResponse.data || {},
      fundAccount: fundAccountResponse.raw || fundAccountResponse.data || {}
    },
    bankAccountNumber: bankAccount,
    accountType
  })

  return {
    payee: updated.payee,
    payeeSnapshot: summarizePayee(updated.payee),
    contactId,
    fundAccountId,
    contactResponse,
    fundAccountResponse
  }
}

const normalizeRazorpayStatus = status => {
  const normalized = String(status || '')
    .trim()
    .toLowerCase()
  if (
    ['captured', 'paid', 'processed', 'success', 'completed'].includes(
      normalized
    )
  ) {
    return 'SUCCESS'
  }
  if (
    [
      'failed',
      'failure',
      'reversed',
      'rejected',
      'cancelled',
      'canceled'
    ].includes(normalized)
  ) {
    return 'FAILED'
  }
  if (['refunded', 'refund'].includes(normalized)) {
    return 'REFUNDED'
  }
  if (
    [
      'authorized',
      'queued',
      'pending',
      'processing',
      'created',
      'initiated'
    ].includes(normalized)
  ) {
    return 'PENDING'
  }
  return 'PENDING'
}

const extractPayoutEntity = payload => {
  const nested = payload?.payload?.payout?.entity
  if (nested && typeof nested === 'object') {
    return nested
  }

  if (payload?.payout?.entity && typeof payload.payout.entity === 'object') {
    return payload.payout.entity
  }

  if (payload && typeof payload === 'object') {
    return payload
  }

  return {}
}

const safeTimingSafeEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8')
  const rightBuffer = Buffer.from(String(right || ''), 'utf8')
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

const getRazorpayPayoutWebhookSignature = headers => {
  const signature = String(
    headers?.['x-razorpay-signature'] ||
      headers?.['X-Razorpay-Signature'] ||
      headers?.signature ||
      ''
  ).trim()

  return signature || null
}

const verifyRazorpayPayoutWebhookSignature = ({
  rawBody = '',
  signature = '',
  secret = razorpayPayoutWebhookSecret
} = {}) => {
  const cleanedSecret = String(secret || '').trim()
  if (!cleanedSecret) {
    return {
      valid: false,
      reason: 'missing_secret',
      message: 'Razorpay payout webhook secret is not configured'
    }
  }

  const expectedSignature = crypto
    .createHmac('sha256', cleanedSecret)
    .update(String(rawBody || ''))
    .digest('hex')

  return {
    valid: safeTimingSafeEqual(
      String(expectedSignature).toLowerCase(),
      String(signature || '').toLowerCase()
    ),
    expectedSignature
  }
}

const verifyRazorpayPayoutWebhook = (body = {}, headers = {}, rawBody = '') => {
  const signature = getRazorpayPayoutWebhookSignature(headers)
  const entity = extractPayoutEntity(body)
  const eventName = String(body?.event || entity?.status || '')
    .trim()
    .toLowerCase()
  const payoutId = String(
    entity?.id ||
      entity?.payout_id ||
      entity?.reference_id ||
      entity?.fund_account_id ||
      ''
  ).trim()
  const referenceId = String(entity?.reference_id || entity?.referenceId || '').trim()
  const verification = verifyRazorpayPayoutWebhookSignature({
    rawBody,
    signature,
    secret: razorpayPayoutWebhookSecret
  })

  return {
    valid: verification.valid,
    reason: verification.reason || (verification.valid ? null : 'signature_mismatch'),
    message:
      verification.message ||
      (verification.valid
        ? null
        : 'Invalid Razorpay payout webhook signature'),
    signaturePresent: Boolean(signature),
    eventName,
    payoutId,
    referenceId,
    entity,
    signature
  }
}

const buildTransferRemarks = ({
  referenceType,
  referenceId,
  fallback = 'Porttivo payout'
} = {}) => {
  const parts = [referenceType, referenceId]
    .map(value => String(value || '').trim())
    .filter(Boolean)

  return parts.join(' ') || fallback
}

const buildRazorpayNarration = (referenceType, referenceId) => {
  const narration = buildTransferRemarks({
    referenceType,
    referenceId,
    fallback: 'Porttivo payout'
  })

  return String(narration || 'Porttivo payout')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
}

const buildRazorpayRequestBody = ({
  payout,
  fundAccountId,
  transferMode = 'IMPS',
  idempotencyKey
}) => {
  if (!razorpayPayoutAccountNumber) {
    const error = new Error('RAZORPAY_PAYOUT_ACCOUNT_NUMBER is not configured')
    error.statusCode = 500
    throw error
  }

  return {
    request: {
      account_number: razorpayPayoutAccountNumber,
      fund_account_id: fundAccountId,
      amount: normalizeIntegerAmount(payout.amount),
      currency: payout.currency || 'INR',
      mode: transferMode || 'IMPS',
      purpose: 'payout',
      queue_if_low_balance: true,
      reference_id:
        String(payout.referenceId || payout._id || '')
          .trim()
          .slice(0, 40) || undefined,
      narration: buildRazorpayNarration(
        payout.referenceType,
        payout.referenceId
      ),
      notes: {
        payout_id: payout._id ? payout._id.toString() : '',
        payment_id: safeObjectIdString(payout.paymentId) || '',
        reference_type: payout.referenceType || '',
        reference_id: payout.referenceId || '',
        remarks: buildTransferRemarks({
          referenceType: payout.referenceType,
          referenceId: payout.referenceId
        })
      }
    },
    headers: {
      'X-Payout-Idempotency': idempotencyKey || makeIdempotencyKey(payout._id)
    }
  }
}

const createRazorpayPayoutRecord = async ({
  payerId,
  payeeId,
  payeeType,
  paymentId,
  referenceType,
  referenceId,
  amount,
  currency = 'INR',
  status = 'CREATED',
  failure = null,
  retry = {},
  razorpay = {}
}) => {
  if (!payerId || !payeeId) {
    const error = new Error(
      'payerId and payeeId are required for payout creation'
    )
    error.statusCode = 400
    throw error
  }

  const existingByPayment = paymentId
    ? await Payout.findOne({ paymentId, provider: 'RAZORPAY' }).sort({
        createdAt: -1
      })
    : null

  if (existingByPayment) {
    return existingByPayment
  }

  const existingByReference =
    referenceType || referenceId
      ? await Payout.findOne({
          referenceType,
          referenceId,
          provider: 'RAZORPAY'
        }).sort({ createdAt: -1 })
      : null

  if (
    existingByReference &&
    ['SUCCESS', 'PROCESSING', 'CREATED', 'RETRY_PENDING'].includes(
      existingByReference.status
    )
  ) {
    return existingByReference
  }

  const payout = new Payout({
    payerId,
    payeeId,
    payeeType,
    paymentId: paymentId || null,
    referenceType: referenceType || null,
    referenceId: referenceId || null,
    amount: Number(normalizeMoney(amount)),
    currency,
    provider: 'RAZORPAY',
    razorpay: {
      contactId: razorpay.contactId || null,
      fundAccountId: razorpay.fundAccountId || null,
      payoutId: razorpay.payoutId || null,
      referenceId: razorpay.referenceId || null,
      utr: razorpay.utr || null,
      transferMode: razorpay.transferMode || 'IMPS',
      statusDetails: razorpay.statusDetails || {},
      beneficiary: razorpay.beneficiary || {},
      request: razorpay.request || {},
      response: razorpay.response || {}
    },
    status,
    failure: failure || buildPayoutFailure({}),
    retry: {
      count: retry.count || 0,
      maxRetry: retry.maxRetry || 3,
      nextRetryAt: retry.nextRetryAt || null
    },
    initiatedAt: new Date(),
    startedAt: razorpay.payoutId ? new Date() : null,
    lastAttemptAt: razorpay.payoutId ? new Date() : null
  })

  return savePayoutWithLogs(payout)
}

const findExistingRazorpayPayout = async ({
  paymentId,
  referenceType,
  referenceId
}) => {
  const query = { provider: 'RAZORPAY' }
  if (paymentId) {
    query.paymentId = paymentId
  } else if (referenceType || referenceId) {
    if (referenceType) query.referenceType = referenceType
    if (referenceId) query.referenceId = referenceId
  } else {
    return null
  }

  return Payout.findOne(query).sort({ createdAt: -1 })
}

const ensureAutomaticPayoutMetadata = payment => {
  const metadata = payment?.metadata || {}
  const payoutMeta =
    metadata.payout && typeof metadata.payout === 'object'
      ? metadata.payout
      : metadata

  const payeeId = payoutMeta.payeeId || metadata.payeeId || null
  if (!payeeId) {
    return null
  }

  return {
    payeeId,
    payeeType: payoutMeta.payeeType || metadata.payeeType || null,
    transferMode: payoutMeta.transferMode || metadata.transferMode || 'IMPS',
    referenceType: payoutMeta.referenceType || payment.referenceType || null,
    referenceId: payoutMeta.referenceId || payment.referenceId || null,
    amount: payoutMeta.amount || payment.amount,
    currency: payoutMeta.currency || payment.currency || 'INR',
    bankAccount: payoutMeta.bankAccount || metadata.bankAccount || null,
    ifsc: payoutMeta.ifsc || metadata.ifsc || null,
    accountType:
      payoutMeta.accountType || metadata.accountType || 'bank_account'
  }
}

const startRazorpayPayoutTransfer = async (
  payoutInput,
  { fetchImpl = getFetchImpl() } = {}
) => {
  let payout =
    payoutInput && payoutInput._id && payoutInput.status
      ? payoutInput
      : await Payout.findById(payoutInput)

  if (!payout) {
    return null
  }

  if (payout.status === 'SUCCESS') {
    return payout
  }

  if (payout.provider !== 'RAZORPAY') {
    payout.provider = 'RAZORPAY'
  }

  const payment = payout.paymentId
    ? await PaymentSession.findById(payout.paymentId)
    : null

  if (payment && payment.status !== 'SUCCESS') {
    payout.status = 'FAILED'
    payout.failure = buildPayoutFailure({
      code: 'PAYMENT_NOT_SUCCESS',
      message: 'Payment must be successful before payout transfer',
      reason: 'Payment not successful',
      isRetryable: false
    })
    await payout.save()
    return payout
  }

  const { payee } = await findPayeeRecordById(payout.payeeId)
  const beneficiary = payee?.razorpayBeneficiary || {}
  let fundAccountId =
    payout.razorpay?.fundAccountId || beneficiary.fundAccountId || null
  let contactId = payout.razorpay?.contactId || beneficiary.contactId || null

  const autoMeta = payment ? ensureAutomaticPayoutMetadata(payment) : null
  if (!fundAccountId && autoMeta?.bankAccount && autoMeta?.ifsc) {
    const synced = await syncRazorpayBeneficiaryForPayee(
      {
        payeeId: payee?._id,
        name: payee?.name || payee?.company || payee?.pumpName || null,
        email: payee?.email || null,
        phone: payee?.mobile || null,
        bankAccount: autoMeta.bankAccount,
        ifsc: autoMeta.ifsc,
        accountType: autoMeta.accountType || 'bank_account'
      },
      fetchImpl
    )
    fundAccountId = synced.fundAccountId
    contactId = synced.contactId
  }

  if (!fundAccountId) {
    payout.status = 'RETRY_PENDING'
    payout.failure = buildPayoutFailure({
      code: 'RAZORPAY_BENEFICIARY_NOT_FOUND',
      message: 'Payment safe. Transfer pending.',
      reason: 'Payee Razorpay beneficiary is not active',
      isRetryable: false
    })
    payout.retry = {
      ...(payout.retry || {}),
      nextRetryAt: null
    }
    await payout.save()
    return payout
  }

  const successfulDuplicate = await Payout.findOne({
    _id: { $ne: payout._id },
    paymentId: payout.paymentId || null,
    provider: 'RAZORPAY',
    status: 'SUCCESS'
  })
  if (successfulDuplicate) {
    return successfulDuplicate
  }

  const lockedPayout = await Payout.findOneAndUpdate(
    {
      _id: payout._id,
      provider: 'RAZORPAY',
      status: { $in: ['CREATED', 'RETRY_PENDING'] }
    },
    {
      $set: {
        status: 'PROCESSING',
        startedAt: payout.startedAt || new Date(),
        lastAttemptAt: new Date(),
        'razorpay.contactId': contactId,
        'razorpay.fundAccountId': fundAccountId,
        'razorpay.transferMode': payout.razorpay?.transferMode || 'IMPS',
        'razorpay.beneficiary':
          beneficiary || payout.razorpay?.beneficiary || {},
        'razorpay.request': {
          ...(payout.razorpay?.request || {}),
          contactId,
          fundAccountId,
          amount: String(Number(normalizeMoney(payout.amount)).toFixed(2)),
          transferMode: payout.razorpay?.transferMode || 'IMPS'
        }
      }
    },
    { new: true }
  )

  if (!lockedPayout) {
    return Payout.findById(payout._id)
  }

  payout = lockedPayout

  try {
    const requestBody = buildRazorpayRequestBody({
      payout,
      fundAccountId,
      transferMode: payout.razorpay?.transferMode || 'IMPS'
    })

    const response = await razorpayRequest('/payouts', {
      method: 'POST',
      body: requestBody.request,
      headers: requestBody.headers,
      fetchImpl
    })

    console.log('==== Razorpay Create Payout Response ====')
    console.dir(response.data, { depth: null })

    const parsed = parseRazorpayResponse(response.data)
    console.log('Parsed:')
    console.dir(parsed, { depth: null })
    console.log('PayoutId:', parsed.payoutId)

    payout.razorpay = {
      ...(payout.razorpay || {}),
      contactId,
      fundAccountId,
      payoutId: parsed.payoutId || payout.razorpay?.payoutId || null,
      referenceId:
        parsed.data?.reference_id ||
        parsed.data?.referenceId ||
        payout.razorpay?.referenceId ||
        null,
      utr:
        parsed.utr ||
        parsed.data?.utr ||
        parsed.data?.utr_no ||
        parsed.data?.utrNo ||
        payout.razorpay?.utr ||
        null,
      transferMode: requestBody.request.mode,
      statusDetails:
        parsed.statusDetails || payout.razorpay?.statusDetails || {},
      beneficiary: beneficiary || payout.razorpay?.beneficiary || {},
      request: {
        ...(payout.razorpay?.request || {}),
        ...requestBody.request
      },
      response: sanitizeResponse(parsed.raw || response.data || {})
    }
    payout.lastAttemptAt = new Date()

    const status = normalizeRazorpayPayoutStatus(
      parsed.status || parsed.data?.status
    )
    if (status === 'SUCCESS') {
      payout.status = 'SUCCESS'
      payout.completedAt = new Date()
      payout.failure = buildPayoutFailure({})
      payout.retry = {
        ...(payout.retry || {}),
        nextRetryAt: null
      }
    } else if (status === 'FAILED') {
      payout.status = 'FAILED'
      payout.completedAt = new Date()
      payout.failure = buildPayoutFailure({
        code: parsed.code || 'PAYOUT_FAILED',
        message: parsed.message || 'Payout failed',
        reason: parsed.message || 'Payout failed',
        isRetryable: false
      })
    } else {
      payout.status = 'PROCESSING'
      payout.failure = buildPayoutFailure({
        code: parsed.code || 'PAYOUT_PROCESSING',
        message: parsed.message || 'Payout processing',
        reason: parsed.message || 'Payout processing',
        isRetryable: true
      })
    }

    await savePayoutWithLogs(payout)
    return payout
  } catch (error) {
    const message = error?.message || 'Razorpay payout request failed'
    logger.error('[RAZORPAY PAYOUT] Transfer failed', {
      payoutId: payout._id.toString(),
      message,
      stack: error.stack
    })

    const isRetryable = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      '503',
      '500',
      '502',
      '504',
      '429'
    ].some(token => String(message).toUpperCase().includes(token))

    payout.status = isRetryable ? 'PROCESSING' : 'FAILED'
    payout.failure = buildPayoutFailure({
      code: isRetryable ? 'RAZORPAY_SERVER_ERROR' : 'PAYOUT_ERROR',
      message,
      reason: message,
      isRetryable
    })
    payout.lastAttemptAt = new Date()
    if (!isRetryable) {
      payout.completedAt = new Date()
    }
    await savePayoutWithLogs(payout)
    return payout
  }
}

const createAutomaticPayoutForPayment = async (
  paymentInput,
  { fetchImpl = getFetchImpl() } = {}
) => {
  const payment =
    paymentInput && paymentInput._id && paymentInput.status
      ? paymentInput
      : await PaymentSession.findById(paymentInput)

  if (!payment || payment.status !== 'SUCCESS') {
    return null
  }

  const autoMetadata = ensureAutomaticPayoutMetadata(payment)
  if (!autoMetadata) {
    return null
  }

  const embeddedPayoutId = payment.metadata?.payout?.id || null
  if (embeddedPayoutId && mongoose.Types.ObjectId.isValid(embeddedPayoutId)) {
    const embeddedPayout = await Payout.findById(embeddedPayoutId)
    if (embeddedPayout) {
      if (
        embeddedPayout.status === 'CREATED' ||
        embeddedPayout.status === 'RETRY_PENDING' ||
        embeddedPayout.status === 'PROCESSING'
      ) {
        return startRazorpayPayoutTransfer(embeddedPayout, { fetchImpl })
      }
      return embeddedPayout
    }
  }

  const existing = await findExistingRazorpayPayout({
    paymentId: payment._id,
    referenceType: autoMetadata.referenceType,
    referenceId: autoMetadata.referenceId
  })

  if (existing) {
    if (
      existing.status === 'CREATED' ||
      existing.status === 'RETRY_PENDING' ||
      existing.status === 'PROCESSING'
    ) {
      return startRazorpayPayoutTransfer(existing, { fetchImpl })
    }
    return existing
  }

  const { payee, modelName } = await findPayeeRecordById(autoMetadata.payeeId)
  const payeeSnapshot = getPayeeSnapshot(payee, modelName)

  const payout = await createRazorpayPayoutRecord({
    payerId: payment.payer?.userId || payment.initiatedBy?.userId || null,
    payeeId: autoMetadata.payeeId,
    payeeType: autoMetadata.payeeType || payeeSnapshot?.userType || null,
    paymentId: payment._id,
    referenceType: autoMetadata.referenceType || payment.referenceType || null,
    referenceId: autoMetadata.referenceId || payment.referenceId || null,
    amount: autoMetadata.amount,
    currency: autoMetadata.currency || payment.currency || 'INR',
    status: 'CREATED',
    razorpay: {
      fundAccountId: payee?.razorpayBeneficiary?.fundAccountId || null,
      contactId: payee?.razorpayBeneficiary?.contactId || null,
      transferMode: autoMetadata.transferMode || 'IMPS',
      beneficiary: payee?.razorpayBeneficiary || {},
      request: {},
      response: {}
    }
  })

  const hydratedPayout =
    payout && payout._id && typeof payout.save === 'function'
      ? payout
      : await findExistingRazorpayPayout({
          paymentId: payment._id,
          referenceType:
            autoMetadata.referenceType || payment.referenceType || null,
          referenceId: autoMetadata.referenceId || payment.referenceId || null
        })

  if (!hydratedPayout) {
    throw new Error('Automatic payout could not be reloaded after creation')
  }

  if (
    (!payee?.razorpayBeneficiary?.fundAccountId ||
      !payee?.razorpayBeneficiary?.contactId) &&
    !(autoMetadata.bankAccount && autoMetadata.ifsc)
  ) {
    hydratedPayout.status = 'RETRY_PENDING'
    hydratedPayout.failure = buildPayoutFailure({
      code: 'RAZORPAY_BENEFICIARY_NOT_FOUND',
      message: 'Payment safe. Transfer pending.',
      reason: 'Payee Razorpay beneficiary is not active',
      isRetryable: false
    })
    await savePayoutWithLogs(hydratedPayout)
    return hydratedPayout
  }

  if (
    (!payee?.razorpayBeneficiary?.fundAccountId ||
      !payee?.razorpayBeneficiary?.contactId) &&
    autoMetadata.bankAccount &&
    autoMetadata.ifsc
  ) {
    await syncRazorpayBeneficiaryForPayee(
      {
        payeeId: autoMetadata.payeeId,
        name: payee?.name || payee?.company || payee?.pumpName || null,
        email: payee?.email || null,
        phone: payee?.mobile || null,
        bankAccount: autoMetadata.bankAccount,
        ifsc: autoMetadata.ifsc,
        accountType: autoMetadata.accountType || 'bank_account'
      },
      fetchImpl
    )
    return startRazorpayPayoutTransfer(hydratedPayout, { fetchImpl })
  }

  return startRazorpayPayoutTransfer(hydratedPayout, { fetchImpl })
}

const isRazorpayRetryDue = payout => {
  if (!payout) return false
  if (payout.status === 'RETRY_PENDING') {
    if (!payout.retry?.nextRetryAt) {
      return payout.failure?.isRetryable === true
    }
    return new Date(payout.retry.nextRetryAt).getTime() <= Date.now()
  }

  if (payout.status === 'PROCESSING') {
    const lastAttempt =
      payout.lastAttemptAt || payout.updatedAt || payout.createdAt
    return (
      !lastAttempt ||
      Date.now() - new Date(lastAttempt).getTime() >= STALE_PROCESSING_WINDOW_MS
    )
  }

  return false
}

const syncRazorpayPayoutStatus = async (
  payout,
  { fetchImpl = getFetchImpl() } = {}
) => {
  if (!payout) {
    return null
  }

  const payoutId = String(payout?.razorpay?.payoutId || '').trim()
  if (!payoutId) {
    return payout
  }

  const previousStatus = payout.status
  const remoteResponse = await getRazorpayPayout(payoutId, { fetchImpl })
  const parsed = parseRazorpayResponse(remoteResponse)
  const remoteStatus = normalizeRazorpayPayoutStatus(
    parsed.status || parsed.data?.status
  )

  payout.razorpay = {
    ...(payout.razorpay || {}),
    payoutId,
    referenceId:
      parsed.data?.reference_id ||
      parsed.data?.referenceId ||
      payout.razorpay?.referenceId ||
      null,
    utr:
      parsed.utr ||
      parsed.data?.utr ||
      parsed.data?.utr_no ||
      parsed.data?.utrNo ||
      payout.razorpay?.utr ||
      null,
    statusDetails: parsed.statusDetails || payout.razorpay?.statusDetails || {},
    response: sanitizeResponse(parsed.raw || remoteResponse || {})
  }

  if (shouldApplyRazorpayPayoutStatusUpdate(previousStatus, remoteStatus)) {
    if (remoteStatus === 'SUCCESS') {
      payout.status = 'SUCCESS'
      payout.completedAt = payout.completedAt || new Date()
      payout.failure = buildPayoutFailure({})
      payout.retry = {
        ...(payout.retry || {}),
        nextRetryAt: null
      }
    } else if (remoteStatus === 'FAILED') {
      payout.status = 'FAILED'
      payout.completedAt = payout.completedAt || new Date()
      payout.failure = buildPayoutFailure({
        code: parsed.code || 'PAYOUT_FAILED',
        message: parsed.message || 'Payout failed',
        reason: parsed.message || 'Payout failed',
        isRetryable: false
      })
    } else {
      payout.status = 'PROCESSING'
      payout.failure = buildPayoutFailure({
        code: parsed.code || 'PAYOUT_PROCESSING',
        message: parsed.message || 'Payout processing',
        reason: parsed.message || 'Payout processing',
        isRetryable: true
      })
    }
  }

  console.log('Mongo status before update:', previousStatus)
  console.log('Mongo status after update:', payout.status)
  return savePayoutWithLogs(payout)
}

const processDuePayoutRetries = async ({
  fetchImpl = getFetchImpl(),
  limit = 25
} = {}) => {
  const payouts = await Payout.find({
    provider: 'RAZORPAY',
    status: { $in: ['RETRY_PENDING', 'PROCESSING'] }
  })
    .sort({ updatedAt: 1 })
    .limit(limit)

  const processed = []
  for (const payout of payouts) {
    if (!isRazorpayRetryDue(payout)) {
      continue
    }

    // eslint-disable-next-line no-await-in-loop
    const updated = payout.razorpay?.payoutId
      ? await syncRazorpayPayoutStatus(payout, { fetchImpl })
      : await startRazorpayPayoutTransfer(payout, { fetchImpl })
    processed.push(updated)
  }

  return processed
}

const verifyRazorpayPaymentSignature = ({
  orderId,
  paymentId,
  signature
} = {}) => {
  const normalizedOrderId = String(orderId || '').trim()
  const normalizedPaymentId = String(paymentId || '').trim()
  const normalizedSignature = String(signature || '').trim()

  if (!normalizedOrderId || !normalizedPaymentId || !normalizedSignature) {
    return false
  }

  const digest = crypto
    .createHmac('sha256', razorpayPayoutKeySecret)
    .update(`${normalizedOrderId}|${normalizedPaymentId}`)
    .digest('hex')

  return digest.toLowerCase() === normalizedSignature.toLowerCase()
}

const verifyRazorpayCheckoutPayload = body => {
  if (!body || typeof body !== 'object') {
    return false
  }

  return verifyRazorpayPaymentSignature({
    orderId: body.razorpay_order_id,
    paymentId: body.razorpay_payment_id,
    signature: body.razorpay_signature
  })
}

const processRazorpayPayoutWebhook = async ({
  body = {},
  headers = {},
  rawBody = '',
  verifiedWebhook = null,
  fetchImpl = getFetchImpl()
} = {}) => {
  const verification =
    verifiedWebhook && verifiedWebhook.valid !== undefined
      ? verifiedWebhook
      : verifyRazorpayPayoutWebhook(body, headers, rawBody)

  if (!verification.valid) {
    if (verification.reason === 'missing_secret') {
      logger.error('[RAZORPAY PAYOUT WEBHOOK] Missing webhook secret', {
        event: verification.eventName || null,
        payoutId: verification.payoutId || null,
        referenceId: verification.referenceId || null,
        signaturePresent: verification.signaturePresent
      })
      const error = new Error(
        verification.message || 'Razorpay payout webhook is not configured'
      )
      error.statusCode = 500
      throw error
    }

    const error = new Error('Invalid Razorpay payout webhook signature')
    error.statusCode = 400
    throw error
  }

  const entity = verification.entity || {}
  const payoutId = verification.payoutId
  const referenceId = verification.referenceId
  const eventName = verification.eventName || 'unknown'
  const webhookStatus = normalizeRazorpayPayoutStatus(
    entity.status || eventName || body.event || body.status
  )

  logger.info('[RAZORPAY PAYOUT WEBHOOK] Received', {
    event: eventName,
    payoutId,
    referenceId,
    signatureValid: true,
    status: webhookStatus
  })

  const payoutQuery = payoutId
    ? { 'razorpay.payoutId': payoutId, provider: 'RAZORPAY' }
    : referenceId
    ? { 'razorpay.referenceId': referenceId, provider: 'RAZORPAY' }
    : entity.fund_account_id
    ? { 'razorpay.fundAccountId': entity.fund_account_id, provider: 'RAZORPAY' }
    : null

  if (!payoutQuery) {
    logger.warn('[RAZORPAY PAYOUT WEBHOOK] No payout lookup key found', {
      event: eventName,
      payoutId,
      referenceId
    })
    return null
  }

  const payoutQueryResult = Payout.findOne(payoutQuery)
  let payout =
    typeof payoutQueryResult?.sort === 'function'
      ? await payoutQueryResult.sort({ createdAt: -1 })
      : await payoutQueryResult

  if (!payout) {
    logger.warn('[RAZORPAY PAYOUT WEBHOOK] Payout record not found', {
      event: eventName,
      payoutId,
      referenceId,
      lookup: payoutQuery
    })
    return null
  }

  const webhookEventId = String(
    headers['x-razorpay-event-id'] ||
      headers['X-Razorpay-Event-Id'] ||
      entity.event_id ||
      body.event_id ||
      body.id ||
      ''
  ).trim()

  if (webhookEventId) {
    const claimedPayout = await Payout.findOneAndUpdate(
      {
        _id: payout._id,
        provider: 'RAZORPAY',
        'razorpay.lastWebhookEventId': { $ne: webhookEventId }
      },
      {
        $set: {
          lastWebhookAt: new Date(),
          'razorpay.lastWebhookEventId': webhookEventId
        }
      },
      { new: true }
    )

    if (!claimedPayout) {
      logger.info('[RAZORPAY PAYOUT WEBHOOK] Duplicate event ignored', {
        event: eventName,
        payoutId,
        referenceId,
        eventId: webhookEventId
      })
      return null
    }

    payout = claimedPayout
  }

  const previousStatus = payout.status
  logger.info('[RAZORPAY PAYOUT WEBHOOK] Processing payout', {
    event: eventName,
    payoutId,
    referenceId,
    internalPayoutId: payout._id?.toString?.() || null,
    previousStatus,
    incomingStatus: webhookStatus
  })

  payout.lastWebhookAt = new Date()
  payout.razorpay = {
    ...(payout.razorpay || {}),
    payoutId: payoutId || payout.razorpay?.payoutId || null,
    referenceId: referenceId || payout.razorpay?.referenceId || null,
    transferMode: entity.mode || payout.razorpay?.transferMode || 'IMPS',
    lastWebhookEvent: eventName,
    lastWebhookStatus: webhookStatus,
    lastWebhookEventId:
      entity.event_id ||
      body.event_id ||
      body.id ||
      payout.razorpay?.lastWebhookEventId ||
      null,
    statusDetails:
      entity.status_details ||
      entity.statusDetails ||
      payout.razorpay?.statusDetails ||
      {},
    beneficiary: payout.razorpay?.beneficiary || {},
    response: {
      ...(payout.razorpay?.response || {}),
      ...sanitizeResponse(body)
    }
  }

  if (shouldApplyRazorpayPayoutStatusUpdate(previousStatus, webhookStatus)) {
    if (webhookStatus === 'SUCCESS') {
      payout.status = 'SUCCESS'
      payout.completedAt = payout.completedAt || new Date()
      payout.failure = buildPayoutFailure({})
      payout.retry = {
        ...(payout.retry || {}),
        nextRetryAt: null
      }
    } else if (webhookStatus === 'FAILED') {
      payout.status = 'FAILED'
      payout.completedAt = payout.completedAt || new Date()
      payout.failure = buildPayoutFailure({
        code: entity.error_code || entity.code || 'PAYOUT_FAILED',
        message:
          entity.status_message ||
          entity.reason ||
          entity.message ||
          'Payout failed',
        reason:
          entity.status_message ||
          entity.reason ||
          entity.message ||
          'Payout failed',
        isRetryable: false
      })
    } else {
      payout.status = 'PROCESSING'
      payout.failure = buildPayoutFailure({
        code: entity.error_code || entity.code || 'PAYOUT_PROCESSING',
        message: entity.status_message || entity.reason || 'Payout processing',
        reason: entity.status_message || entity.reason || 'Payout processing',
        isRetryable: true
      })
    }
  }

  const savedPayout = await savePayoutWithLogs(payout)

  if (savedPayout?.razorpay?.payoutId) {
    try {
      const syncedPayout = await syncRazorpayPayoutStatus(savedPayout, { fetchImpl })
      logger.info('[RAZORPAY PAYOUT WEBHOOK] Background sync complete', {
        event: eventName,
        payoutId,
        referenceId,
        internalPayoutId: syncedPayout?._id?.toString?.() || null,
        status: syncedPayout?.status || null
      })
      return syncedPayout
    } catch (syncError) {
      logger.error('[RAZORPAY PAYOUT WEBHOOK] Background sync failed', {
        event: eventName,
        payoutId,
        referenceId,
        message: syncError.message,
        stack: syncError.stack
      })
    }
  }

  return savedPayout
}

const handleRazorpayPayoutWebhook = async (args = {}) =>
  processRazorpayPayoutWebhook(args)

const getPayoutSummary = async () => {
  const [created, processing, success, failed, retryPending, cancelled, total] =
    await Promise.all([
      Payout.countDocuments({ provider: 'RAZORPAY', status: 'CREATED' }),
      Payout.countDocuments({ provider: 'RAZORPAY', status: 'PROCESSING' }),
      Payout.countDocuments({ provider: 'RAZORPAY', status: 'SUCCESS' }),
      Payout.countDocuments({ provider: 'RAZORPAY', status: 'FAILED' }),
      Payout.countDocuments({ provider: 'RAZORPAY', status: 'RETRY_PENDING' }),
      Payout.countDocuments({ provider: 'RAZORPAY', status: 'CANCELLED' }),
      Payout.countDocuments({ provider: 'RAZORPAY' })
    ])

  return {
    total,
    created,
    processing,
    success,
    failed,
    retryPending,
    cancelled
  }
}

const listRazorpayContacts = async ({
  query = {},
  fetchImpl = getFetchImpl()
} = {}) => {
  const result = await razorpayRequest('/contacts', {
    method: 'GET',
    query,
    fetchImpl
  })
  return result.data || {}
}

const getRazorpayContact = async (
  contactId,
  { fetchImpl = getFetchImpl() } = {}
) => {
  if (!contactId) {
    const error = new Error('contactId is required')
    error.statusCode = 400
    throw error
  }
  const result = await razorpayRequest(
    `/contacts/${String(contactId).trim()}`,
    { method: 'GET', fetchImpl }
  )
  return result.data || {}
}

const listRazorpayFundAccounts = async ({
  query = {},
  fetchImpl = getFetchImpl()
} = {}) => {
  const result = await razorpayRequest('/fund_accounts', {
    method: 'GET',
    query,
    fetchImpl
  })
  return result.data || {}
}

const getRazorpayFundAccount = async (
  fundAccountId,
  { fetchImpl = getFetchImpl() } = {}
) => {
  if (!fundAccountId) {
    const error = new Error('fundAccountId is required')
    error.statusCode = 400
    throw error
  }
  const result = await razorpayRequest(
    `/fund_accounts/${String(fundAccountId).trim()}`,
    { method: 'GET', fetchImpl }
  )
  return result.data || {}
}

const createRazorpayPayout = async (
  body,
  { headers = {}, fetchImpl = getFetchImpl() } = {}
) => {
  const result = await razorpayRequest('/payouts', {
    method: 'POST',
    body,
    headers,
    fetchImpl
  })
  return result.data || {}
}

const listRazorpayPayouts = async ({
  query = {},
  fetchImpl = getFetchImpl()
} = {}) => {
  const result = await razorpayRequest('/payouts', {
    method: 'GET',
    query,
    fetchImpl
  })
  return result.data || {}
}

const getRazorpayPayout = async (
  payoutId,
  { fetchImpl = getFetchImpl() } = {}
) => {
  if (!payoutId) {
    const error = new Error('payoutId is required')
    error.statusCode = 400
    throw error
  }
  const result = await razorpayRequest(`/payouts/${String(payoutId).trim()}`, {
    method: 'GET',
    fetchImpl
  })
  return result.data || {}
}

const listRazorpayTransactions = async ({
  query = {},
  fetchImpl = getFetchImpl()
} = {}) => {
  const result = await razorpayRequest('/transactions', {
    method: 'GET',
    query,
    fetchImpl
  })
  return result.data || {}
}

const getRazorpayTransaction = async (
  txnId,
  { fetchImpl = getFetchImpl() } = {}
) => {
  if (!txnId) {
    const error = new Error('txnId is required')
    error.statusCode = 400
    throw error
  }
  const result = await razorpayRequest(
    `/transactions/${String(txnId).trim()}`,
    { method: 'GET', fetchImpl }
  )
  return result.data || {}
}
const isPayeePayoutReady = async payeeId => {
  const { payee, modelName } = await findPayeeRecordById(payeeId)

  if (!payee) {
    return {
      ready: false,
      reason: 'PAYEE_NOT_FOUND',
      message: 'Payee record not found'
    }
  }

  const beneficiary = payee.razorpayBeneficiary || {}

  if (
    !beneficiary.contactId ||
    !beneficiary.fundAccountId ||
    String(beneficiary.status || '').toUpperCase() !== 'ACTIVE'
  ) {
    return {
      ready: false,
      reason: 'RAZORPAY_BENEFICIARY_NOT_READY',
      message:
        "Payee's Razorpay beneficiary details have not been added or are not active"
    }
  }

  return {
    ready: true,
    contactId: beneficiary.contactId,
    fundAccountId: beneficiary.fundAccountId,
    payee,
    modelName
  }
}

const isTransporterPayoutReady = isPayeePayoutReady

const isDriverPayoutReady = async driverId => {
  const { payee } = await findPayeeRecordById(driverId)

  if (!payee) {
    return {
      ready: false,
      reason: 'DRIVER_NOT_FOUND'
    }
  }

  const beneficiary = payee.razorpayBeneficiary || {}

  if (
    !beneficiary.contactId ||
    !beneficiary.fundAccountId ||
    String(beneficiary.status).toUpperCase() !== 'ACTIVE'
  ) {
    return {
      ready: false,
      reason: 'RAZORPAY_FUND_ACCOUNT_NOT_READY'
    }
  }

  return {
    ready: true,
    contactId: beneficiary.contactId,
    fundAccountId: beneficiary.fundAccountId
  }
}

module.exports = {
  createAutomaticPayoutForPayment,
  createRazorpayPayoutRecord,
  findPayeeRecordById,
  getPayeeSnapshot,
  getPayoutSummary,
  handleRazorpayPayoutWebhook,
  makeIdempotencyKey,
  makeTransferId,
  normalizeMoney,
  processDuePayoutRetries,
  processRazorpayPayoutWebhook,
  patchPayeeRazorpayBeneficiary,
  syncRazorpayBeneficiaryForPayee,
  startRazorpayPayoutTransfer,
  syncRazorpayPayoutStatus,
  verifyRazorpayPayoutWebhook,
  verifyRazorpayPayoutWebhookSignature,
  verifyRazorpayCheckoutPayload,
  verifyRazorpayPaymentSignature,
  // Proxy / utility functions
  createRazorpayContact,
  listRazorpayContacts,
  getRazorpayContact,
  createRazorpayFundAccount,
  listRazorpayFundAccounts,
  getRazorpayFundAccount,
  createRazorpayPayout,
  listRazorpayPayouts,
  getRazorpayPayout,
  listRazorpayTransactions,
  getRazorpayTransaction,
  isDriverPayoutReady,
  isPayeePayoutReady,
  isTransporterPayoutReady
}
