const crypto = require('crypto')
const mongoose = require('mongoose')
const logger = require('../utils/logger')
const { Payout } = (() => {
  const model = require('../models/Payout')
  return { Payout: model }
})()
const PaymentSession = require('../models/PaymentSession')
const Transporter = require('../models/Transporter')
const Driver = require('../models/Driver')
const Customer = require('../models/Customer')
const PumpOwner = require('../models/PumpOwner')
const CompanyUser = require('../models/CompanyUser')
const {
  cashfreePayoutMode,
  cashfreePayoutClientId,
  cashfreePayoutClientSecret,
  cashfreePayoutWebhookSecret,
  cashfreePayoutApiBaseUrl,
  cashfreePayoutWebhookUrl,
  cashfreePayoutWebhookStrictValidation,
  cashfreePayoutBankEncryptionSecret
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

let cachedAuthToken = null
let cachedAuthTokenExpiresAt = 0
let cronTimer = null

const safeObjectIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString ? value.toString() : String(value)
}

const makeTransferId = (prefix = 'PTP') => {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`
  }
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`
}

const normalizeMoney = (amount) => {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Valid payout amount is required')
  }
  return Number(value.toFixed(2))
}

const getEncryptionKey = () => {
  const rawKey = String(cashfreePayoutBankEncryptionSecret || cashfreePayoutClientSecret || '').trim()
  if (!rawKey) {
    throw new Error('Payout encryption key is not configured')
  }
  return crypto.createHash('sha256').update(rawKey).digest()
}

const encryptSensitiveValue = (value) => {
  const text = String(value || '').trim()
  if (!text) return null

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

const maskBankAccount = (value) => {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= 4) return text
  return `${'*'.repeat(Math.max(0, text.length - 4))}${text.slice(-4)}`
}

const summarizePayee = (payee) => {
  if (!payee) return null
  return {
    id: payee._id ? payee._id.toString() : null,
    model: payee.constructor?.modelName || payee.userType || null,
    name: payee.name || payee.company || payee.pumpName || null,
    email: payee.email || null,
    mobile: payee.mobile || null,
    cashfreeBeneId: payee.cashfreeBeneId || null,
    beneficiary: payee.cashfreeBeneficiary || null
  }
}

const serializePayout = (payout, { includeSensitive = false } = {}) => {
  if (!payout) return null

  const beneficiary = payout.cashfree?.beneficiary || {}
  const request = payout.cashfree?.request || {}
  const response = payout.cashfree?.response || {}

  return {
    id: payout._id ? payout._id.toString() : null,
    payerId: safeObjectIdString(payout.payerId),
    payeeId: safeObjectIdString(payout.payeeId),
    payeeType: payout.payeeType || null,
    paymentId: safeObjectIdString(payout.paymentId),
    referenceType: payout.referenceType || null,
    referenceId: payout.referenceId || null,
    amount: payout.amount,
    currency: payout.currency,
    provider: payout.provider,
    cashfree: {
      beneId: payout.cashfree?.beneId || null,
      transferId: payout.cashfree?.transferId || null,
      referenceId: payout.cashfree?.referenceId || null,
      transferMode: payout.cashfree?.transferMode || null,
      utr: payout.cashfree?.utr || null,
      beneficiary: {
        ...beneficiary,
        bankAccount: includeSensitive ? beneficiary.bankAccount : null,
        bankAccountMasked: maskBankAccount(beneficiary.bankAccount || beneficiary.bankAccountMasked || null)
      },
      request,
      response
    },
    status: payout.status,
    failure: payout.failure || null,
    retry: payout.retry || null,
    initiatedAt: payout.initiatedAt || null,
    startedAt: payout.startedAt || null,
    completedAt: payout.completedAt || null,
    lastAttemptAt: payout.lastAttemptAt || null,
    lastWebhookAt: payout.lastWebhookAt || null,
    createdAt: payout.createdAt || null,
    updatedAt: payout.updatedAt || null
  }
}

const findPayeeRecordById = async (payeeId) => {
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

const buildBeneficiaryId = (payee, modelName) => {
  const idPart = safeObjectIdString(payee?._id) || makeTransferId('PAYEE')
  const modelPart = String(modelName || payee?.constructor?.modelName || 'PAYEE').toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return `${modelPart}_${idPart}`.slice(0, 50)
}

const parseCashfreeResponse = (payload) => {
  if (!payload) return { raw: payload, status: null }

  if (typeof payload === 'string') {
    try {
      return parseCashfreeResponse(JSON.parse(payload))
    } catch (error) {
      return { raw: payload, status: null }
    }
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload
  const status = String(
    data.status ||
      data.subCode ||
      data.payment_status ||
      data.transferStatus ||
      data.beneficiary_status ||
      ''
  ).trim().toUpperCase()

  return {
    raw: payload,
    data,
    status,
    transferId: data.transferId || data.transfer_id || data.referenceId || data.reference_id || null,
    beneId: data.beneId || data.bene_id || null,
    utr: data.utr || data.utr_no || data.utrNo || null,
    code: data.code || data.subCode || data.errorCode || null,
    message: data.message || data.error || data.errorMessage || null
  }
}

const getCashfreeHeaders = (extraHeaders = {}) => ({
  'X-Client-Id': cashfreePayoutClientId,
  'X-Client-Secret': cashfreePayoutClientSecret,
  'X-Api-Version': '2024-01-01',
  'Content-Type': 'application/json',
  ...extraHeaders
})

const cashfreeRequest = async (path, { method = 'GET', body = null, query = null, headers = {}, fetchImpl = global.fetch } = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available for Cashfree payout requests')
  }

  const url = new URL(`${cashfreePayoutApiBaseUrl}${path}`)
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const response = await fetchImpl(url.toString(), {
    method,
    headers: getCashfreeHeaders(headers),
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

const authorizeCashfreePayout = async (fetchImpl = global.fetch) => {
  if (cachedAuthToken && Date.now() < cachedAuthTokenExpiresAt) {
    return cachedAuthToken
  }

  if (!cashfreePayoutClientId || !cashfreePayoutClientSecret) {
    const error = new Error('Cashfree payout client id and secret are not configured')
    error.statusCode = 500
    throw error
  }

  const result = await cashfreeRequest('/authorize', {
    method: 'POST',
    fetchImpl
  })

  if (!result.ok) {
    const message = result.data?.message || result.data?.error || `Cashfree payout authorization failed with status ${result.status}`
    throw new Error(message)
  }

  const token =
    result.data?.data?.token ||
    result.data?.data?.access_token ||
    result.data?.data?.accessToken ||
    result.data?.token ||
    result.data?.authToken ||
    result.data?.access_token ||
    result.data?.accessToken ||
    result.data?.data?.result?.token ||
    result.data?.result?.token ||
    null

  if (!token) {
    const error = new Error('Cashfree payout authorization token was not returned')
    error.details = {
      response: result.data,
      status: result.status
    }
    throw error
  }

  const expiresInSeconds = Number(result.data?.data?.expires_in || result.data?.expires_in || 45 * 60)
  cachedAuthToken = token
  cachedAuthTokenExpiresAt = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000
  return token
}

const getCashfreeAuthorizedHeaders = async (fetchImpl = global.fetch) => {
  const token = await authorizeCashfreePayout(fetchImpl)
  return {
    Authorization: `Bearer ${token}`
  }
}

const validateBankDetails = async ({ name, email, phone, bankAccount, ifsc }, fetchImpl = global.fetch) => {
  const authHeaders = await getCashfreeAuthorizedHeaders(fetchImpl)
  const result = await cashfreeRequest('/validation/bankDetails', {
    method: 'GET',
    query: {
      name,
      email,
      phone,
      bankAccount,
      ifsc
    },
    headers: authHeaders,
    fetchImpl
  })

  const parsed = parseCashfreeResponse(result.data)
  const verified = result.ok && !['ERROR', 'FAILED', 'INVALID', 'REJECTED'].includes(parsed.status)
  const verificationSuiteNotEnabled =
    parsed.code === '422' ||
    String(parsed.message || '').toLowerCase().includes('verification suite is not enabled')

  return {
    verified,
    response: parsed.raw,
    data: parsed.data,
    status: parsed.status,
    code: parsed.code,
    message: parsed.message,
    verificationSuiteNotEnabled
  }
}

const normalizeAddressField = (value) => String(value || '').trim()

const resolveBeneficiaryAddress = ({ payee, address = {} } = {}) => {
  const sourceLocation = payee?.location || {}
  return {
    address1:
      normalizeAddressField(address.address1 || address.address || address.beneficiaryAddress) ||
      normalizeAddressField(sourceLocation.address),
    city:
      normalizeAddressField(address.city || address.beneficiaryCity) ||
      normalizeAddressField(sourceLocation.city),
    state:
      normalizeAddressField(address.state || address.beneficiaryState) ||
      normalizeAddressField(sourceLocation.state),
    pincode:
      normalizeAddressField(address.pincode || address.postalCode || address.beneficiaryPostalCode) ||
      normalizeAddressField(sourceLocation.pincode || sourceLocation.postalCode),
    country:
      normalizeAddressField(address.country || address.countryCode || address.beneficiaryCountry) ||
      normalizeAddressField(sourceLocation.countryCode || sourceLocation.country) ||
      'IN'
  }
}

const addCashfreeBeneficiary = async ({ beneId, name, email, phone, bankAccount, ifsc, address }, fetchImpl = global.fetch) => {
  await authorizeCashfreePayout(fetchImpl)
  const result = await cashfreeRequest('/v2/beneficiary', {
    method: 'POST',
    body: {
      beneficiary_id: beneId,
      beneficiary_name: name,
      beneficiary_instrument_details: {
        bank_account_number: bankAccount,
        bank_ifsc: ifsc
      },
      beneficiary_contact_details: {
        beneficiary_address: address?.address1 || '',
        beneficiary_city: address?.city || '',
        beneficiary_state: address?.state || '',
        beneficiary_postal_code: address?.pincode || '',
        beneficiary_phone: phone || ''
      },
      beneficiary_email: email || ''
    },
    headers: await getCashfreeAuthorizedHeaders(fetchImpl),
    fetchImpl
  })

  const parsed = parseCashfreeResponse(result.data)
  if (!result.ok) {
    const message = parsed.message || result.data?.message || `Cashfree add beneficiary failed with status ${result.status}`
    throw new Error(message)
  }

  return parsed
}

const requestAsyncTransfer = async ({ beneId, amount, transferId, transferMode = 'IMPS', remarks = '' }, fetchImpl = global.fetch) => {
  await authorizeCashfreePayout(fetchImpl)
  const result = await cashfreeRequest('/v2/transfers', {
    method: 'POST',
    body: {
      beneficiary_details: {
        beneficiary_id: beneId
      },
      transfer_amount: String(Number(amount).toFixed(2)),
      transfer_id: transferId,
      transfer_mode: transferMode,
      transfer_remarks: remarks || ''
    },
    headers: await getCashfreeAuthorizedHeaders(fetchImpl),
    fetchImpl
  })

  return {
    ok: result.ok,
    httpStatus: result.status,
    ...parseCashfreeResponse(result.data)
  }
}

const setPayeeBeneficiaryOnModel = async ({ payee, modelName, beneId, bankDetails, beneficiaryResponse, address }) => {
  payee.cashfreeBeneId = beneId
  payee.cashfreeBeneficiary = {
    beneId,
    name: bankDetails.name || payee.name || payee.company || payee.pumpName || null,
    email: bankDetails.email || payee.email || null,
    phone: bankDetails.phone || payee.mobile || null,
    status: 'ACTIVE',
    bankAccountEncrypted: encryptSensitiveValue(bankDetails.bankAccount),
    ifscEncrypted: encryptSensitiveValue(bankDetails.ifsc),
    bankAccountLast4: maskBankAccount(bankDetails.bankAccount),
    address: address || {},
    verification: beneficiaryResponse || {},
    createdAt: new Date(),
    updatedAt: new Date()
  }
  await payee.save()
  return {
    payee,
    modelName
  }
}

const registerBeneficiary = async ({ payeeId, name, email, phone, bankAccount, ifsc, address = {} }, fetchImpl = global.fetch) => {
  const { payee, modelName } = await findPayeeRecordById(payeeId)
  if (!payee) {
    const error = new Error('Payee not found')
    error.statusCode = 404
    throw error
  }

  const resolvedAddress = resolveBeneficiaryAddress({ payee, address })
  if (!resolvedAddress.address1 || !resolvedAddress.city || !resolvedAddress.state || !resolvedAddress.pincode) {
    const error = new Error('Beneficiary address1, city, state, and pincode are required for Cashfree v2')
    error.statusCode = 400
    throw error
  }

  const beneId = payee.cashfreeBeneId || buildBeneficiaryId(payee, modelName)
  const beneficiaryResponse = await addCashfreeBeneficiary(
    { beneId, name, email, phone, bankAccount, ifsc, address: resolvedAddress },
    fetchImpl
  )

  const updated = await setPayeeBeneficiaryOnModel({
    payee,
    modelName,
    beneId,
    bankDetails: { name, email, phone, bankAccount, ifsc },
    beneficiaryResponse,
    address: resolvedAddress
  })

  return {
    payee: updated.payee,
    payeeSnapshot: summarizePayee(updated.payee),
    beneId,
    validation: {
      verified: true,
      skipped: true,
      message: 'Beneficiary validation skipped for Cashfree v2'
    },
    beneficiaryResponse,
    verificationWarning: null
  }
}

const findExistingPayout = async ({ paymentId, referenceType, referenceId }) => {
  const query = {}
  if (paymentId) query.paymentId = paymentId
  else if (referenceType || referenceId) {
    if (referenceType) query.referenceType = referenceType
    if (referenceId) query.referenceId = referenceId
  }

  if (!Object.keys(query).length) {
    return null
  }

  const result = Payout.findOne(query)
  return typeof result?.sort === 'function' ? result.sort({ createdAt: -1 }) : result
}

const deriveRetrySchedule = (retryCount) => {
  const index = Math.max(0, Math.min(RETRY_DELAYS_MS.length - 1, retryCount))
  return new Date(Date.now() + RETRY_DELAYS_MS[index])
}

const isTemporaryTransferFailure = (reason, code) => {
  const value = `${code || ''} ${reason || ''}`.toUpperCase()
  return [
    'INSUFFICIENT_BALANCE',
    'BANK_DOWN',
    'TIMEOUT',
    'NETWORK',
    'SERVER_ERROR',
    'TEMPORARY'
  ].some((token) => value.includes(token))
}

const isPermanentTransferFailure = (reason, code) => {
  const value = `${code || ''} ${reason || ''}`.toUpperCase()
  return [
    'INVALID_ACCOUNT',
    'INVALID_IFSC',
    'BENEFICIARY_NOT_FOUND',
    'BENEFICIARY_INACTIVE',
    'INVALID_BENE',
    'INVALID_BENEFICIARY'
  ].some((token) => value.includes(token))
}

const buildPayoutFailure = ({ code, message, reason, isRetryable }) => ({
  code: code || null,
  message: message || reason || null,
  reason: reason || message || null,
  isRetryable: Boolean(isRetryable)
})

const createPayoutRecord = async ({
  payerId,
  payeeId,
  payeeType,
  paymentId,
  referenceType,
  referenceId,
  amount,
  currency = 'INR',
  provider = 'CASHFREE',
  cashfree = {},
  status = 'CREATED',
  failure = null,
  retry = {}
}) => {
  if (!payerId || !payeeId) {
    const error = new Error('payerId and payeeId are required for payout creation')
    error.statusCode = 400
    throw error
  }

  const [existingByPayment, existingByReference] = await Promise.all([
    paymentId
      ? (() => {
          const result = Payout.findOne({ paymentId })
          return typeof result?.sort === 'function' ? result.sort({ createdAt: -1 }) : result
        })()
      : Promise.resolve(null),
    !paymentId && referenceId
      ? (() => {
          const result = Payout.findOne({ referenceType, referenceId, provider })
          return typeof result?.sort === 'function' ? result.sort({ createdAt: -1 }) : result
        })()
      : Promise.resolve(null)
  ])

  if (existingByPayment) {
    return existingByPayment
  }

  if (existingByReference && ['SUCCESS', 'PROCESSING', 'CREATED', 'RETRY_PENDING'].includes(existingByReference.status)) {
    return existingByReference
  }

  try {
    const [payout] = await Payout.create([
      {
        payerId,
        payeeId,
        payeeType,
        paymentId: paymentId || null,
        referenceType: referenceType || null,
        referenceId: referenceId || null,
        amount: Number(normalizeMoney(amount)),
        currency,
        provider,
        cashfree: {
          beneId: cashfree.beneId || null,
          transferId: cashfree.transferId || null,
          referenceId: cashfree.referenceId || null,
          transferMode: cashfree.transferMode || 'IMPS',
          utr: cashfree.utr || null,
          beneficiary: cashfree.beneficiary || {},
          request: cashfree.request || {},
          response: cashfree.response || {}
        },
        status,
        failure: failure || buildPayoutFailure({}),
        retry: {
          count: retry.count || 0,
          maxRetry: retry.maxRetry || 3,
          nextRetryAt: retry.nextRetryAt || null
        },
        initiatedAt: new Date(),
        startedAt: cashfree.transferId ? new Date() : null,
        lastAttemptAt: cashfree.transferId ? new Date() : null
      }
    ])

    return payout
  } catch (error) {
    const isDuplicateKey = error?.code === 11000 || String(error?.message || '').includes('E11000 duplicate key error')
    if (!isDuplicateKey) {
      throw error
    }

    const fallbackQuery = {}
    if (paymentId) {
      fallbackQuery.paymentId = paymentId
    } else if (referenceType || referenceId) {
      if (referenceType) fallbackQuery.referenceType = referenceType
      if (referenceId) fallbackQuery.referenceId = referenceId
      fallbackQuery.provider = provider
    }

    const result = Object.keys(fallbackQuery).length ? Payout.findOne(fallbackQuery) : null
    return typeof result?.sort === 'function' ? result.sort({ createdAt: -1 }) : result
  }
}

const getPayoutById = async (id) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return null
  }
  return Payout.findById(id)
}

const applyPayoutTransferResponse = async (payout, response, { fetchImpl = global.fetch } = {}) => {
  const parsed = response || {}
  const normalizedStatus = String(parsed.status || '').trim().toUpperCase()
  const responsePayload = parsed.raw || parsed.data || parsed
  const httpStatus = Number(parsed.httpStatus || 0)
  const transferId = parsed.transferId || payout.cashfree?.transferId || makeTransferId('PTP')
  const utr = parsed.utr || responsePayload?.utr || responsePayload?.utr_no || null
  const code = parsed.code || responsePayload?.code || null
  const message = parsed.message || responsePayload?.message || null
  const reason = message || code || 'Payout transfer response received'

  payout.cashfree = {
    ...(payout.cashfree || {}),
    transferId,
    referenceId: transferId,
    response: responsePayload,
    utr: normalizedStatus === 'SUCCESS' ? utr || payout.cashfree?.utr || null : payout.cashfree?.utr || null
  }
  payout.lastAttemptAt = new Date()

  if (httpStatus === 403) {
    payout.status = 'FAILED'
    payout.completedAt = new Date()
    payout.failure = buildPayoutFailure({
      code: '403',
      message:
        message ||
        'The payout v1 and v1.2 APIs have been deprecated. Please use v2 APIs.',
      reason,
      isRetryable: false
    })
    payout.retry = {
      ...(payout.retry || {}),
      nextRetryAt: null
    }
    await payout.save()
    return payout
  }

  if (normalizedStatus === 'SUCCESS') {
    payout.status = 'SUCCESS'
    payout.completedAt = new Date()
    payout.failure = buildPayoutFailure({})
    payout.retry = {
      ...(payout.retry || {}),
      nextRetryAt: null
    }
    await payout.save()
    return payout
  }

  if (normalizedStatus === 'PENDING') {
    payout.status = 'PROCESSING'
    payout.startedAt = payout.startedAt || new Date()
    await payout.save()
    return payout
  }

  if (normalizedStatus === 'ERROR') {
    const isPermanent = isPermanentTransferFailure(reason, code)
    const isRetryable = !isPermanent && isTemporaryTransferFailure(reason, code)

    if (String(code) === '403' || String(reason).toLowerCase().includes('deprecated')) {
      payout.status = 'FAILED'
      payout.failure = buildPayoutFailure({
        code: '403',
        message:
          message ||
          'The payout v1 and v1.2 APIs have been deprecated. Please use v2 APIs.',
        reason,
        isRetryable: false
      })
      payout.completedAt = new Date()
      payout.retry = {
        ...(payout.retry || {}),
        nextRetryAt: null
      }
      await payout.save()
      return payout
    }

    if (code === 'INSUFFICIENT_BALANCE' || String(reason).toUpperCase().includes('INSUFFICIENT_BALANCE')) {
      payout.status = 'RETRY_PENDING'
      payout.failure = buildPayoutFailure({
        code,
        message: 'Payment received successfully. Payout is queued and will process shortly.',
        reason,
        isRetryable: true
      })
      payout.retry = {
        ...(payout.retry || {}),
        count: (payout.retry?.count || 0) + 1,
        maxRetry: payout.retry?.maxRetry || 3,
        nextRetryAt: deriveRetrySchedule(payout.retry?.count || 0)
      }
      await payout.save()
      return payout
    }

    if (isPermanent) {
      payout.status = 'FAILED'
      payout.failure = buildPayoutFailure({
        code,
        message: message || 'Payee bank details are incorrect. Please update account details.',
        reason,
        isRetryable: false
      })
      payout.completedAt = new Date()
      payout.retry = {
        ...(payout.retry || {}),
        nextRetryAt: null
      }
      await payout.save()
      return payout
    }

    if (isRetryable) {
      payout.status = 'RETRY_PENDING'
      payout.failure = buildPayoutFailure({
        code,
        message: message || 'Payout processing will retry shortly.',
        reason,
        isRetryable: true
      })
      const retryCount = (payout.retry?.count || 0) + 1
      payout.retry = {
        ...(payout.retry || {}),
        count: retryCount,
        maxRetry: payout.retry?.maxRetry || 3,
        nextRetryAt: retryCount >= (payout.retry?.maxRetry || 3) ? null : deriveRetrySchedule(retryCount - 1)
      }
      if (retryCount >= (payout.retry?.maxRetry || 3)) {
        payout.status = 'FAILED'
        payout.completedAt = new Date()
      }
      await payout.save()
      return payout
    }

    payout.status = 'PROCESSING'
    payout.failure = buildPayoutFailure({
      code,
      message: message || 'Payout is processing',
      reason,
      isRetryable: true
    })
    await payout.save()
    return payout
  }

  payout.status = 'PROCESSING'
  payout.failure = buildPayoutFailure({
    code,
    message: message || 'Payout is processing',
    reason,
    isRetryable: true
  })
  await payout.save()
  return payout
}

const startPayoutTransfer = async (payoutInput, { fetchImpl = global.fetch } = {}) => {
  const payout =
    payoutInput && payoutInput._id && typeof payoutInput.save === 'function'
      ? payoutInput
      : await getPayoutById(payoutInput)

  if (!payout) {
    const error = new Error('Payout record not found')
    error.statusCode = 404
    throw error
  }

  const payment = payout.paymentId ? await PaymentSession.findById(payout.paymentId) : null
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
  const beneficiary = payee?.cashfreeBeneficiary
  const beneId = payout.cashfree?.beneId || payee?.cashfreeBeneId || beneficiary?.beneId || null

  if (!beneId || beneficiary?.status !== 'ACTIVE') {
    payout.status = 'RETRY_PENDING'
    payout.failure = buildPayoutFailure({
      code: 'BENEFICIARY_NOT_FOUND',
      message: 'Payment safe. Transfer pending.',
      reason: 'Payee beneficiary is not active',
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
    status: 'SUCCESS'
  })

  if (successfulDuplicate) {
    return successfulDuplicate
  }

  payout.cashfree = {
    ...(payout.cashfree || {}),
    beneId,
    transferId: payout.cashfree?.transferId || makeTransferId('PTP'),
    transferMode: payout.cashfree?.transferMode || 'IMPS',
    beneficiary: beneficiary || payout.cashfree?.beneficiary || {},
    request: {
      beneId,
      amount: String(Number(normalizeMoney(payout.amount)).toFixed(2)),
      transferId: payout.cashfree?.transferId || makeTransferId('PTP'),
      transferMode: payout.cashfree?.transferMode || 'IMPS'
    }
  }

  if (payout.status === 'SUCCESS') {
    return payout
  }

  await payout.save()

  try {
    const response = await requestAsyncTransfer(
      {
        beneId,
        amount: payout.amount,
        transferId: payout.cashfree.transferId,
        transferMode: payout.cashfree.transferMode || 'IMPS',
        remarks: payout.referenceId || payout.referenceType || 'Porttivo payout'
      },
      fetchImpl
    )

    payout.cashfree.request = {
      ...(payout.cashfree.request || {}),
      amount: String(Number(normalizeMoney(payout.amount)).toFixed(2))
    }
    return applyPayoutTransferResponse(payout, response, { fetchImpl })
  } catch (error) {
    const message = error?.message || 'Cashfree payout request failed'
    const isNetworkOrServerIssue = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      '503',
      '500',
      '502',
      '504'
    ].some((token) => String(message).toUpperCase().includes(token))

    payout.lastAttemptAt = new Date()
    payout.cashfree = {
      ...(payout.cashfree || {}),
      transferId: payout.cashfree?.transferId || makeTransferId('PTP')
    }

    if (isNetworkOrServerIssue) {
      payout.status = 'PROCESSING'
      payout.failure = buildPayoutFailure({
        code: 'CASHFREE_SERVER_ERROR',
        message: 'Payout processing',
        reason: message,
        isRetryable: true
      })
      await payout.save()
      return payout
    }

    const isPermanent = isPermanentTransferFailure(message, '')
    payout.retry = {
      ...(payout.retry || {}),
      count: (payout.retry?.count || 0) + 1,
      maxRetry: payout.retry?.maxRetry || 3,
      nextRetryAt: null
    }
    payout.status = isPermanent ? 'FAILED' : 'RETRY_PENDING'
    payout.failure = buildPayoutFailure({
      code: isPermanent ? 'INVALID_BENEFICIARY' : 'TRANSFER_ERROR',
      message,
      reason: message,
      isRetryable: !isPermanent
    })
    if (payout.status === 'FAILED') {
      payout.completedAt = new Date()
    } else {
      payout.retry.nextRetryAt = deriveRetrySchedule(Math.max(0, payout.retry.count - 1))
    }
    await payout.save()
    return payout
  }
}

const ensureAutomaticPayoutMetadata = (payment) => {
  const metadata = payment?.metadata || {}
  const payoutMeta = metadata.payout && typeof metadata.payout === 'object' ? metadata.payout : metadata

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
    currency: payoutMeta.currency || payment.currency || 'INR'
  }
}

const createAutomaticPayoutForPayment = async (paymentInput, { fetchImpl = global.fetch } = {}) => {
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
        return startPayoutTransfer(embeddedPayout, { fetchImpl })
      }
      return embeddedPayout
    }
  }

  const existing = await findExistingPayout({
    paymentId: payment._id,
    referenceType: autoMetadata.referenceType,
    referenceId: autoMetadata.referenceId
  })

  if (existing) {
    if (existing.status === 'CREATED' || existing.status === 'RETRY_PENDING' || existing.status === 'PROCESSING') {
      return startPayoutTransfer(existing, { fetchImpl })
    }
    return existing
  }

  const { payee, modelName } = await findPayeeRecordById(autoMetadata.payeeId)
  const payeeSnapshot = getPayeeSnapshot(payee, modelName)

  const payout = await createPayoutRecord({
    payerId: payment.payer?.userId || payment.initiatedBy?.userId || null,
    payeeId: autoMetadata.payeeId,
    payeeType: autoMetadata.payeeType || payeeSnapshot?.userType || null,
    paymentId: payment._id,
    referenceType: autoMetadata.referenceType || payment.referenceType || null,
    referenceId: autoMetadata.referenceId || payment.referenceId || null,
    amount: autoMetadata.amount,
    currency: autoMetadata.currency || payment.currency || 'INR',
    status: 'CREATED',
    cashfree: {
      beneId: payee?.cashfreeBeneId || payee?.cashfreeBeneficiary?.beneId || null,
      transferMode: autoMetadata.transferMode || 'IMPS',
      beneficiary: payee?.cashfreeBeneficiary || {},
      request: {},
      response: {}
    }
  })

  if (!payee?.cashfreeBeneId || payee?.cashfreeBeneficiary?.status !== 'ACTIVE') {
    payout.status = 'RETRY_PENDING'
    payout.failure = buildPayoutFailure({
      code: 'BENEFICIARY_NOT_FOUND',
      message: 'Payment safe. Transfer pending.',
      reason: 'Payee beneficiary is not active',
      isRetryable: false
    })
    await payout.save()
    return payout
  }

  return startPayoutTransfer(payout, { fetchImpl })
}

const isPayoutRetryDue = (payout) => {
  if (!payout) return false
  if (payout.status === 'RETRY_PENDING') {
    if (!payout.retry?.nextRetryAt) {
      return payout.failure?.code === 'INSUFFICIENT_BALANCE' || payout.failure?.isRetryable === true
    }
    return new Date(payout.retry.nextRetryAt).getTime() <= Date.now()
  }

  if (payout.status === 'PROCESSING') {
    const lastAttempt = payout.lastAttemptAt || payout.updatedAt || payout.createdAt
    return !lastAttempt || Date.now() - new Date(lastAttempt).getTime() >= STALE_PROCESSING_WINDOW_MS
  }

  return false
}

const processDuePayoutRetries = async ({ fetchImpl = global.fetch, limit = 25 } = {}) => {
  const payouts = await Payout.find({
    status: { $in: ['RETRY_PENDING', 'PROCESSING'] }
  })
    .sort({ updatedAt: 1 })
    .limit(limit)

  const processed = []
  for (const payout of payouts) {
    if (!isPayoutRetryDue(payout)) {
      continue
    }

    // eslint-disable-next-line no-await-in-loop
    const updated = await startPayoutTransfer(payout, { fetchImpl })
    processed.push(updated)
  }

  return processed
}

const startPayoutAutomationCron = ({ fetchImpl = global.fetch } = {}) => {
  if (cronTimer) {
    return cronTimer
  }

  cronTimer = setInterval(() => {
    processDuePayoutRetries({ fetchImpl }).catch((error) => {
      logger.error('Payout retry cron failed', {
        message: error.message,
        stack: error.stack
      })
    })
  }, 15 * 60 * 1000)

  if (typeof cronTimer.unref === 'function') {
    cronTimer.unref()
  }

  return cronTimer
}

const stopPayoutAutomationCron = () => {
  if (cronTimer) {
    clearInterval(cronTimer)
    cronTimer = null
  }
}

const stableStringify = (value) => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value !== 'object') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`
}

const buildWebhookCandidates = (body, rawBody = '') => {
  const candidates = []
  const raw = typeof rawBody === 'string' ? rawBody.trim() : ''
  if (raw) {
    candidates.push(raw)
  }

  if (body && typeof body === 'object') {
    try {
      candidates.push(JSON.stringify(body))
    } catch (error) {
      // ignore JSON stringify issues and fall back to stable stringify
    }
    candidates.push(stableStringify(body))
  } else if (typeof body === 'string' && body.trim()) {
    candidates.push(body.trim())
  }

  return [...new Set(candidates.filter(Boolean))]
}

const verifyWebhookSignature = ({ signature, body, rawBody, secrets = [] }) => {
  const normalizedSignature = String(signature || '').trim()
  if (!normalizedSignature) {
    return false
  }

  const candidates = buildWebhookCandidates(body, rawBody)

  for (const secret of secrets) {
    const cleanedSecret = String(secret || '').trim()
    if (!cleanedSecret) {
      continue
    }

    for (const candidate of candidates) {
      const expectedHex = crypto.createHmac('sha256', cleanedSecret).update(candidate).digest('hex')
      const expectedBase64 = crypto.createHmac('sha256', cleanedSecret).update(candidate).digest('base64')

      if (
        [expectedHex, expectedBase64].some(
          (expected) => expected === normalizedSignature || expected === normalizedSignature.toLowerCase()
        )
      ) {
        return true
      }
    }
  }

  return false
}

const verifyCashfreePayoutWebhook = (body, headers = {}, rawBody = '') => {
  const signature = String(
    headers['x-webhook-signature'] ||
      headers['X-Webhook-Signature'] ||
      headers['x-signature'] ||
      headers['x-cashfree-signature'] ||
      headers.signature ||
      ''
  ).trim()

  return verifyWebhookSignature({
    signature,
    body,
    rawBody,
    secrets: [cashfreePayoutWebhookSecret, cashfreePayoutClientSecret]
  })
}

const handleCashfreePayoutWebhook = async ({ body = {}, headers = {}, rawBody = '', fetchImpl = global.fetch } = {}) => {
  if (!verifyCashfreePayoutWebhook(body, headers, rawBody)) {
    if (cashfreePayoutWebhookStrictValidation) {
      const error = new Error('Invalid Cashfree payout webhook signature')
      error.statusCode = 400
      throw error
    }
  }

  const payload = body && typeof body === 'object' ? body : {}
  const transferId = String(
    payload.transferId || payload.transfer_id || payload.referenceId || payload.reference_id || payload.beneId || ''
  ).trim()
  const referenceId = String(payload.referenceId || payload.reference_id || '').trim()
  const utr = payload.utr || payload.utr_no || payload.utrNo || null

  const payoutQuery = Payout.findOne(
    transferId
      ? { 'cashfree.transferId': transferId }
      : referenceId
        ? { 'cashfree.referenceId': referenceId }
        : {}
  )
  const payout = typeof payoutQuery?.sort === 'function' ? await payoutQuery.sort({ createdAt: -1 }) : await payoutQuery

  if (!payout) {
    const error = new Error('Payout record not found')
    error.statusCode = 404
    throw error
  }

  payout.lastWebhookAt = new Date()
  payout.cashfree = {
    ...(payout.cashfree || {}),
    response: payload,
    referenceId: referenceId || payout.cashfree?.referenceId || payout.cashfree?.transferId || null,
    utr: utr || payout.cashfree?.utr || null
  }

  const status = String(payload.status || payload.transferStatus || payload.payout_status || '').trim().toUpperCase()
  if (status === 'SUCCESS') {
    payout.status = 'SUCCESS'
    payout.completedAt = new Date()
    payout.failure = buildPayoutFailure({})
    payout.retry = {
      ...(payout.retry || {}),
      nextRetryAt: null
    }
  } else if (status === 'FAILED') {
    const code = String(payload.code || payload.errorCode || '').trim()
    const message = String(payload.message || payload.error || 'Payout failed').trim()
    const isRetryable = isTemporaryTransferFailure(message, code)
    payout.status = isRetryable ? 'RETRY_PENDING' : 'FAILED'
    payout.failure = buildPayoutFailure({
      code: code || 'PAYOUT_FAILED',
      message,
      reason: message,
      isRetryable
    })
    if (isRetryable) {
      payout.retry = {
        ...(payout.retry || {}),
        count: (payout.retry?.count || 0) + 1,
        maxRetry: payout.retry?.maxRetry || 3,
        nextRetryAt:
          (payout.retry?.count || 0) + 1 >= (payout.retry?.maxRetry || 3)
            ? null
            : deriveRetrySchedule(payout.retry?.count || 0)
      }
    } else {
      payout.completedAt = new Date()
      payout.retry = {
        ...(payout.retry || {}),
        nextRetryAt: null
      }
    }
  } else {
    payout.status = 'PROCESSING'
  }

  await payout.save()
  return payout
}

const buildPayoutStatusMessage = (payout) => {
  if (!payout) {
    return 'Payout not found'
  }

  if (payout.status === 'SUCCESS') {
    return 'Payee received payment'
  }

  if (payout.status === 'PROCESSING') {
    return 'Payout is processing'
  }

  if (payout.status === 'RETRY_PENDING') {
    return payout.failure?.message || 'Payment safe. Transfer pending.'
  }

  if (payout.status === 'FAILED') {
    return payout.failure?.message || 'Payout failed. Support team is checking'
  }

  if (payout.status === 'CANCELLED') {
    return 'Payout cancelled'
  }

  return 'Payout created'
}

const getPayoutSummary = async () => {
  const [created, processing, success, failed, retryPending, cancelled, total] = await Promise.all([
    Payout.countDocuments({ status: 'CREATED' }),
    Payout.countDocuments({ status: 'PROCESSING' }),
    Payout.countDocuments({ status: 'SUCCESS' }),
    Payout.countDocuments({ status: 'FAILED' }),
    Payout.countDocuments({ status: 'RETRY_PENDING' }),
    Payout.countDocuments({ status: 'CANCELLED' }),
    Payout.countDocuments({})
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

module.exports = {
  buildBeneficiaryId,
  buildPayoutFailure,
  buildPayoutStatusMessage,
  createAutomaticPayoutForPayment,
  createPayoutRecord,
  encryptSensitiveValue,
  findExistingPayout,
  findPayeeRecordById,
  getPayoutById,
  getPayoutSummary,
  getPayeeSnapshot,
  handleCashfreePayoutWebhook,
  isPermanentTransferFailure,
  isTemporaryTransferFailure,
  makeTransferId,
  maskBankAccount,
  normalizeMoney,
  processDuePayoutRetries,
  registerBeneficiary,
  requestAsyncTransfer,
  serializePayout,
  setPayeeBeneficiaryOnModel,
  startPayoutAutomationCron,
  startPayoutTransfer,
  stopPayoutAutomationCron,
  validateBankDetails,
  verifyCashfreePayoutWebhook
}
