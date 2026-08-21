const crypto = require('crypto')
const { nanoid } = require('nanoid')
const {
  payuKey,
  payuSalt,
  payuCheckoutUrl,
  payuMode,
  payuWebhookUrl,
  paymentScreenPayuSuccessUrl,
  paymentScreenPayuFailureUrl,
  paymentScreenPayuWebhookUrl,
  payuMode: currentPayuMode,
  cashfreeMode,
  cashfreeClientId,
  cashfreeClientSecret,
  cashfreeWebhookSecret,
  cashfreeApiVersion,
  cashfreeApiBaseUrl,
  cashfreeCheckoutUrl,
  cashfreeReturnUrl,
  cashfreeWebhookUrl,
  razorpayMode,
  razorpayKeyId,
  razorpayKeySecret,
  razorpayWebhookSecret,
  razorpayApiBaseUrl,
  razorpayCheckoutUrl,
  razorpayWebhookUrl
} = require('../config/env')

const SUPPORTED_PAYMENT_PROVIDERS = ['PAYU', 'CASHFREE', 'RAZORPAY']
const DEFAULT_CURRENCY = 'INR'

const normalizeProvider = (provider) => {
  const normalized = String(provider || '').trim().toUpperCase()
  return SUPPORTED_PAYMENT_PROVIDERS.includes(normalized) ? normalized : null
}

const normalizeMoney = (amount) => {
  const value = Number(amount)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Valid payment amount is required')
  }
  return value.toFixed(2)
}

const makeTransactionId = (prefix = 'PTV') => {
  return `${prefix}-${nanoid(20)}`
}

const resolvePayerProfile = (payerInput = {}, user = null) => {
  const userData = user?.userData || {}
  const payer = {
    userId: payerInput.userId || user?.id || null,
    userType: payerInput.userType || user?.userType || null,
    name:
      payerInput.name ||
      userData.name ||
      userData.company ||
      userData.username ||
      null,
    email:
      String(payerInput.email || userData.email || '').trim().toLowerCase() || null,
    mobile:
      String(payerInput.mobile || userData.mobile || '').trim() || null
  }

  return payer
}

const buildGatewayDisplayName = (provider) => {
  if (provider === 'PAYU') return 'PayU'
  if (provider === 'CASHFREE') return 'Cashfree'
  if (provider === 'RAZORPAY') return 'Razorpay'
  return provider
}

const buildPayuCheckoutRequest = ({
  merchantTransactionId,
  amount,
  payer,
  reference,
  paymentSessionId,
  successUrl,
  failureUrl,
  gatewayUrl
}) => {
  if (!payuKey || !payuSalt || !payuCheckoutUrl) {
    throw new Error('PayU is not configured')
  }

  if (!payer?.email) {
    throw new Error('Payer email is required for PayU payment initiation')
  }

  const normalizedAmount = normalizeMoney(amount)
  const firstname = payer.name || 'Payment Customer'
  const productinfo = reference?.purpose
    ? `${reference.purpose} ${reference.referenceId ? `(${reference.referenceId})` : ''}`.trim()
    : 'Payment'

  const fields = {
    key: payuKey,
    txnid: merchantTransactionId || makeTransactionId(),
    amount: normalizedAmount,
    productinfo,
    firstname,
    email: payer.email,
    phone: payer.mobile || '',
    surl: successUrl || paymentScreenPayuSuccessUrl || payuWebhookUrl,
    furl: failureUrl || paymentScreenPayuFailureUrl || payuWebhookUrl,
    udf1: paymentSessionId ? String(paymentSessionId) : '',
    udf2: reference?.referenceType ? String(reference.referenceType) : '',
    udf3: reference?.referenceId ? String(reference.referenceId) : '',
    udf4: payer?.userId ? String(payer.userId) : '',
    udf5: reference?.purpose ? String(reference.purpose) : '',
    hash: '',
    service_provider: 'payu_paisa'
  }

  const hashString = [
    fields.key,
    fields.txnid,
    fields.amount,
    fields.productinfo,
    fields.firstname,
    fields.email,
    fields.udf1 || '',
    fields.udf2 || '',
    fields.udf3 || '',
    fields.udf4 || '',
    fields.udf5 || '',
    '',
    '',
    '',
    '',
    '',
    payuSalt
  ].join('|')

  fields.hash = crypto.createHash('sha512').update(hashString).digest('hex')

  return {
    actionUrl: gatewayUrl || payuCheckoutUrl,
    method: 'POST',
    provider: 'PAYU',
    mode: currentPayuMode || 'sandbox',
    fields
  }
}

const buildRazorpayOrderPayload = ({
  merchantTransactionId,
  amount,
  currency = DEFAULT_CURRENCY,
  payer,
  reference,
  paymentSessionId,
  callbackUrl
}) => {
  if (!razorpayKeyId || !razorpayKeySecret || !razorpayApiBaseUrl) {
    throw new Error('Razorpay is not configured')
  }

  const normalizedAmount = Number(normalizeMoney(amount))
  const amountInPaise = Math.round(normalizedAmount * 100)
  const receipt = merchantTransactionId || makeTransactionId('RZP')
  const name = payer?.name || 'Payment Customer'
  const description = reference?.purpose
    ? `${reference.purpose}${reference.referenceId ? ` (${reference.referenceId})` : ''}`
    : 'Payment'

  return {
    requestBody: {
      amount: amountInPaise,
      currency: currency || DEFAULT_CURRENCY,
      receipt,
      notes: {
        referenceType: reference?.referenceType ? String(reference.referenceType) : '',
        referenceId: reference?.referenceId ? String(reference.referenceId) : '',
        purpose: reference?.purpose ? String(reference.purpose) : '',
        paymentSessionId: paymentSessionId ? String(paymentSessionId) : '',
        payerId: payer?.userId ? String(payer.userId) : ''
      }
    },
    checkout: {
      name,
      description,
      prefill: {
        name,
        email: payer?.email || '',
        contact: payer?.mobile || ''
      },
      theme: {
        color: '#0f172a'
      },
      readonly: {
        email: false,
        contact: false
      }
    }
  }
}

const createRazorpayOrder = async (payload, fetchImpl = global.fetch) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available for Razorpay order creation')
  }

  const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64')
  const response = await fetchImpl(`${razorpayApiBaseUrl}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const responseText = await response.text()
  let data = null
  try {
    data = responseText ? JSON.parse(responseText) : {}
  } catch (error) {
    data = { raw: responseText }
  }

  if (!response.ok) {
    const message =
      data?.error?.description ||
      data?.error?.message ||
      data?.message ||
      `Razorpay order creation failed with status ${response.status}`
    throw new Error(message)
  }

  return data || {}
}

const verifyPayuWebhook = (body) => {
  if (!body || typeof body !== 'object') {
    return false
  }

  const receivedHash = String(body.hash || '').trim().toLowerCase()
  if (!receivedHash) {
    return false
  }

  const hashString = [
    payuSalt,
    String(body.status || '').toLowerCase(),
    '',
    '',
    '',
    '',
    '',
    String(body.udf5 || ''),
    String(body.udf4 || ''),
    String(body.udf3 || ''),
    String(body.udf2 || ''),
    String(body.udf1 || ''),
    String(body.email || ''),
    String(body.firstname || ''),
    String(body.productinfo || 'Payment'),
    String(body.amount || ''),
    String(body.txnid || ''),
    payuKey
  ].join('|')

  const computedHash = crypto.createHash('sha512').update(hashString).digest('hex')
  return receivedHash === computedHash.toLowerCase()
}

const verifyRazorpayPaymentSignature = (body = {}) => {
  const orderId = String(
    body.razorpay_order_id || body.order_id || body.orderId || ''
  ).trim()
  const paymentId = String(
    body.razorpay_payment_id || body.payment_id || body.paymentId || ''
  ).trim()
  const receivedSignature = String(
    body.razorpay_signature || body.signature || ''
  ).trim()

  if (!orderId || !paymentId || !receivedSignature || !razorpayKeySecret) {
    return false
  }

  const expectedSignature = crypto
    .createHmac('sha256', razorpayKeySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex')

  return expectedSignature.toLowerCase() === receivedSignature.toLowerCase()
}

const normalizePayuStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'success') return 'SUCCESS'
  if (normalized === 'failure') return 'FAILED'
  if (normalized === 'cancel' || normalized === 'cancelled') return 'CANCELLED'
  if (normalized === 'pending') return 'PENDING'
  return 'PENDING'
}

const normalizeRazorpayStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase()
  const terminalSegment = normalized.includes('.')
    ? normalized.split('.').pop()
    : normalized
  if (['captured', 'paid', 'processed', 'success', 'completed'].includes(normalized)) {
    return 'SUCCESS'
  }
  if (['captured', 'paid', 'processed', 'success', 'completed'].includes(terminalSegment)) {
    return 'SUCCESS'
  }
  if (['failed', 'failure', 'reversed', 'rejected', 'cancelled', 'canceled'].includes(normalized)) {
    return 'FAILED'
  }
  if (['failed', 'failure', 'reversed', 'rejected', 'cancelled', 'canceled'].includes(terminalSegment)) {
    return 'FAILED'
  }
  if (['refunded', 'refund'].includes(normalized)) {
    return 'REFUNDED'
  }
  if (['refunded', 'refund'].includes(terminalSegment)) {
    return 'REFUNDED'
  }
  if (['authorized', 'queued', 'pending', 'processing', 'created', 'initiated', 'attempted'].includes(normalized)) {
    return 'PENDING'
  }
  if (['authorized', 'queued', 'pending', 'processing', 'created', 'initiated', 'attempted'].includes(terminalSegment)) {
    return 'PENDING'
  }
  return 'PENDING'
}

const buildCashfreeOrderPayload = ({
  merchantTransactionId,
  amount,
  currency = DEFAULT_CURRENCY,
  payer,
  reference,
  successUrl
}) => {
  if (!cashfreeClientId || !cashfreeClientSecret) {
    throw new Error('Cashfree is not configured')
  }

  if (!payer?.email || !payer?.mobile) {
    throw new Error('Payer email and mobile are required for Cashfree payment initiation')
  }

  const normalizedAmount = normalizeMoney(amount)
  const orderId = merchantTransactionId || makeTransactionId('CF')
  const body = {
    order_id: orderId,
    order_amount: Number(normalizedAmount),
    order_currency: currency || DEFAULT_CURRENCY,
    customer_details: {
      customer_id: String(payer.userId || orderId),
      customer_name: payer.name || 'Payment Customer',
      customer_email: payer.email,
      customer_phone: payer.mobile
    },
    order_meta: {
      return_url: successUrl || cashfreeReturnUrl,
      notify_url: cashfreeWebhookUrl
    },
    order_note: reference?.purpose || 'Payment'
  }

  return {
    actionUrl: cashfreeCheckoutUrl || cashfreeApiBaseUrl,
    method: 'POST',
    provider: 'CASHFREE',
    mode: cashfreeMode || 'sandbox',
    fields: body,
    headers: {
      'x-client-id': cashfreeClientId,
      'x-client-secret': cashfreeClientSecret,
      'x-api-version': cashfreeApiVersion,
      'Content-Type': 'application/json'
    }
  }
}

const createCashfreeOrder = async (payload, fetchImpl = global.fetch) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available for Cashfree order creation')
  }

  const response = await fetchImpl(`${cashfreeApiBaseUrl}/orders`, {
    method: 'POST',
    headers: {
      'x-client-id': cashfreeClientId,
      'x-client-secret': cashfreeClientSecret,
      'x-api-version': cashfreeApiVersion,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })

  const responseText = await response.text()
  let data = null
  try {
    data = responseText ? JSON.parse(responseText) : {}
  } catch (error) {
    data = { raw: responseText }
  }

  if (!response.ok) {
    const message =
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Cashfree order creation failed with status ${response.status}`
    throw new Error(message)
  }

  return data || {}
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

  if (typeof rawBody === 'string' && rawBody.length > 0) {
    candidates.push(rawBody)
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

const verifyCashfreeWebhook = (body, headers = {}, rawBody = '') => {
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
    secrets: [cashfreeWebhookSecret, cashfreeClientSecret]
  })
}

const normalizeCashfreeStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase()
  if (['success', 'paid', 'completed', 'captured'].includes(normalized)) {
    return 'SUCCESS'
  }
  if (['failed', 'failure', 'failed_at_gateway'].includes(normalized)) {
    return 'FAILED'
  }
  if (['cancelled', 'canceled', 'cancel'].includes(normalized)) {
    return 'CANCELLED'
  }
  if (['refund', 'refunded'].includes(normalized)) {
    return 'REFUNDED'
  }
  return 'PENDING'
}

const extractCashfreeStatusValue = (payload = {}) => {
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
  const order = data.order && typeof data.order === 'object' ? data.order : payload.order && typeof payload.order === 'object' ? payload.order : {}
  const payment = data.payment && typeof data.payment === 'object' ? data.payment : payload.payment && typeof payload.payment === 'object' ? payload.payment : {}

  return (
    payload.status ||
    payload.order_status ||
    payload.orderStatus ||
    order.status ||
    order.order_status ||
    order.orderStatus ||
    payment.status ||
    payment.payment_status ||
    payment.paymentStatus ||
    payload.payment_status ||
    payload.paymentStatus ||
    ''
  )
}

const extractGatewayIdentifiers = (provider, payload = {}) => {
  if (provider === 'PAYU') {
    return {
      transactionId:
        payload.mihpayid ||
        payload.payuMoneyId ||
        payload.bank_ref_num ||
        payload.txnid ||
        null,
      orderId: payload.bank_ref_num || payload.txnid || null
    }
  }

  if (provider === 'CASHFREE') {
    const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
    const order = data.order && typeof data.order === 'object' ? data.order : payload.order && typeof payload.order === 'object' ? payload.order : {}
    const payment = data.payment && typeof data.payment === 'object' ? data.payment : payload.payment && typeof payload.payment === 'object' ? payload.payment : {}

    return {
      transactionId:
        payment.cf_payment_id ||
        payment.payment_id ||
        payment.transaction_id ||
        payment.id ||
        data.cf_payment_id ||
        data.payment_id ||
        data.transaction_id ||
        payload.cf_payment_id ||
        payload.payment_id ||
        payload.transaction_id ||
        payload.payment_id ||
        payload.transaction_id ||
        payload.id ||
        null,
      orderId:
        order.cf_order_id ||
        order.order_id ||
        order.orderId ||
        payment.cf_order_id ||
        payment.order_id ||
        payment.orderId ||
        data.cf_order_id ||
        data.order_id ||
        data.orderId ||
        payload.cf_order_id ||
        payload.order_id ||
        payload.orderId ||
        null
    }
  }

  if (provider === 'RAZORPAY') {
    const paymentEntity =
      payload.payload?.payment?.entity ||
      payload.payment?.entity ||
      payload.payment ||
      {}
    const orderEntity =
      payload.payload?.order?.entity ||
      payload.order?.entity ||
      payload.order ||
      {}

    return {
      transactionId:
        paymentEntity.id ||
        paymentEntity.payment_id ||
        paymentEntity.paymentId ||
        payload.razorpay_payment_id ||
        null,
      orderId:
        orderEntity.id ||
        orderEntity.order_id ||
        orderEntity.orderId ||
        paymentEntity.order_id ||
        paymentEntity.orderId ||
        payload.razorpay_order_id ||
        null
    }
  }

  return {
    transactionId: null,
    orderId: null
  }
}

const getProviderConfig = (provider) => {
  const normalized = normalizeProvider(provider)
  if (normalized === 'PAYU') {
    return {
      provider: 'PAYU',
      displayName: buildGatewayDisplayName('PAYU'),
      configured: Boolean(payuKey && payuSalt && payuCheckoutUrl),
      mode: currentPayuMode || 'sandbox'
    }
  }

  if (normalized === 'CASHFREE') {
    return {
      provider: 'CASHFREE',
      displayName: buildGatewayDisplayName('CASHFREE'),
      configured: Boolean(cashfreeClientId && cashfreeClientSecret),
      mode: cashfreeMode || 'sandbox'
    }
  }

  if (normalized === 'RAZORPAY') {
    return {
      provider: 'RAZORPAY',
      displayName: buildGatewayDisplayName('RAZORPAY'),
      configured: Boolean(razorpayKeyId && razorpayKeySecret),
      mode: razorpayMode || 'sandbox'
    }
  }

  return null
}

const getAvailableGatewayOptions = () => {
  return SUPPORTED_PAYMENT_PROVIDERS.map((provider) => ({
    ...getProviderConfig(provider),
    provider
  }))
}

const buildPaymentInitiationRequest = async ({
  provider,
  merchantTransactionId,
  amount,
  payer,
  reference,
  paymentSessionId,
  successUrl,
  failureUrl,
  callbackUrl,
  metadata = {},
  fetchImpl = global.fetch
}) => {
  const normalizedProvider = normalizeProvider(provider)
  if (!normalizedProvider) {
    throw new Error('Unsupported payment provider')
  }

  if (normalizedProvider === 'PAYU') {
    return buildPayuCheckoutRequest({
      merchantTransactionId,
      amount,
      payer,
      reference,
      paymentSessionId,
      successUrl,
      failureUrl
    })
  }

  if (normalizedProvider === 'RAZORPAY') {
    const orderPayload = buildRazorpayOrderPayload({
      merchantTransactionId,
      amount,
      payer,
      reference,
      paymentSessionId,
      callbackUrl
    })

    const orderResponse = await createRazorpayOrder(orderPayload.requestBody, fetchImpl)
    const orderId =
      orderResponse.id ||
      orderResponse.order_id ||
      orderResponse.orderId ||
      orderPayload.requestBody.receipt ||
      merchantTransactionId ||
      makeTransactionId('RZP')

    return {
      actionUrl: razorpayCheckoutUrl,
      method: 'GET',
      provider: 'RAZORPAY',
      mode: razorpayMode || 'sandbox',
      fields: {
        key: razorpayKeyId,
        order_id: orderId,
        amount: orderResponse.amount || orderPayload.requestBody.amount,
        currency: orderResponse.currency || orderPayload.requestBody.currency,
        name: orderPayload.checkout.name,
        description: orderPayload.checkout.description,
        prefill: orderPayload.checkout.prefill,
        notes: {
          ...orderPayload.requestBody.notes,
          razorpay_order_id: orderId
        },
        theme: orderPayload.checkout.theme,
        readonly: orderPayload.checkout.readonly,
        callback_url: callbackUrl || razorpayWebhookUrl,
        redirect: false
      },
      rawResponse: orderResponse
    }
  }

  const payload = buildCashfreeOrderPayload({
    merchantTransactionId,
    amount,
    payer,
    reference,
    successUrl
  })

  const orderResponse = await createCashfreeOrder(
    {
      ...payload.fields,
      order_note:
        metadata.orderNote || payload.fields.order_note || reference?.purpose || 'Payment'
    },
    fetchImpl
  )

  const orderId =
    orderResponse.order_id ||
    orderResponse.orderId ||
    payload.fields.order_id ||
    merchantTransactionId ||
    makeTransactionId('CF')
  const paymentSessionIdValue =
    orderResponse.payment_session_id ||
    orderResponse.paymentSessionId ||
    orderResponse.payment_session ||
    null
  const paymentLink =
    orderResponse.payment_link ||
    orderResponse.paymentLink ||
    orderResponse.checkout_url ||
    orderResponse.checkoutUrl ||
    payload.actionUrl

  return {
    actionUrl: paymentLink || payload.actionUrl,
    method: 'POST',
    provider: 'CASHFREE',
    mode: cashfreeMode || 'sandbox',
    fields: {
      ...payload.fields,
      order_id: orderId,
      payment_session_id: paymentSessionIdValue,
      payment_link: paymentLink || null
    },
    rawResponse: orderResponse
  }
}

const normalizeGatewayStatus = (provider, status) => {
  const normalizedProvider = normalizeProvider(provider)
  if (normalizedProvider === 'PAYU') {
    return normalizePayuStatus(status)
  }
  if (normalizedProvider === 'CASHFREE') {
    return normalizeCashfreeStatus(status)
  }
  if (normalizedProvider === 'RAZORPAY') {
    return normalizeRazorpayStatus(status)
  }
  return 'PENDING'
}

const verifyGatewayWebhook = ({
  provider,
  body,
  headers = {},
  rawBody = ''
}) => {
  const normalizedProvider = normalizeProvider(provider)
  if (normalizedProvider === 'PAYU') {
    return verifyPayuWebhook(body)
  }
  if (normalizedProvider === 'CASHFREE') {
    return verifyCashfreeWebhook(body, headers, rawBody)
  }
  if (normalizedProvider === 'RAZORPAY') {
    const webhookSignature = String(
      headers['x-razorpay-signature'] ||
        headers['X-Razorpay-Signature'] ||
        headers.signature ||
        ''
    ).trim()

    if (webhookSignature && razorpayWebhookSecret) {
      const verified = verifyWebhookSignature({
        signature: webhookSignature,
        body,
        rawBody,
        secrets: [razorpayWebhookSecret]
      })

      if (verified) {
        return true
      }
    }

    return verifyRazorpayPaymentSignature(body)
  }
  return false
}

const getGatewayPayloadMetadata = (provider, payload = {}) => {
  const normalizedProvider = normalizeProvider(provider)
  const { transactionId, orderId } = extractGatewayIdentifiers(normalizedProvider, payload)
  const statusValue =
    normalizedProvider === 'CASHFREE'
      ? extractCashfreeStatusValue(payload)
      : normalizedProvider === 'RAZORPAY'
      ? payload.status ||
        payload.event ||
        payload.payload?.payment?.entity?.status ||
        payload.payload?.order?.entity?.status ||
        payload.payment?.entity?.status ||
        payload.order?.entity?.status ||
        payload.razorpay_payment_status ||
        payload.razorpay_status ||
        payload.payment_status ||
        ''
      : payload.status

  return {
    provider: normalizedProvider,
    providerTransactionId: transactionId,
    providerOrderId: orderId,
    status: normalizeGatewayStatus(normalizedProvider, statusValue)
  }
}


const verifyRazorpayPaymentSignatureNew = ({
  orderId,
  paymentId,
  signature
}) => {
  if (!orderId || !paymentId || !signature) {
    return false
  }

  const secret = process.env.RAZORPAY_KEY_SECRET

  if (!secret) {
    throw new Error(
      'RAZORPAY_KEY_SECRET is not configured'
    )
  }

  const body = `${orderId}|${paymentId}`

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex')

  const expectedBuffer =
    Buffer.from(expectedSignature, 'hex')

  const receivedBuffer =
    Buffer.from(signature, 'hex')

  if (
    expectedBuffer.length !==
    receivedBuffer.length
  ) {
    return false
  }

  return crypto.timingSafeEqual(
    expectedBuffer,
    receivedBuffer
  )
}

module.exports = {
  verifyRazorpayPaymentSignature
}

module.exports = {
  DEFAULT_CURRENCY,
  SUPPORTED_PAYMENT_PROVIDERS,
  buildGatewayDisplayName,
  buildPaymentInitiationRequest,
  createCashfreeOrder,
  createRazorpayOrder,
  extractGatewayIdentifiers,
  getAvailableGatewayOptions,
  getGatewayPayloadMetadata,
  getProviderConfig,
  makeTransactionId,
  normalizeGatewayStatus,
  normalizeMoney,
  normalizeProvider,
  extractCashfreeStatusValue,
  resolvePayerProfile,
  verifyGatewayWebhook,
  verifyCashfreeWebhook,
  verifyPayuWebhook,
  verifyRazorpayPaymentSignature,
  verifyRazorpayPaymentSignatureNew
}
