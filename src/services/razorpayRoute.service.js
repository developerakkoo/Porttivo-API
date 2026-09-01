const crypto = require('crypto')

const {
  razorpayApiBaseUrl,
  razorpayKeyId,
  razorpayKeySecret,
  razorpayPaymentLinkWebhookUrl
} = require('../config/env')

const buildAuthHeader = () => {
  const token = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString(
    'base64'
  )

  return `Basic ${token}`
}

const razorpayRequest = async (
  path,
  { method = 'GET', body = null, fetchImpl = global.fetch } = {}
) => {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available')
  }

  const response = await fetchImpl(`${razorpayApiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: buildAuthHeader(),
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  })

  const text = await response.text()

  let data = {}

  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = {
      raw: text
    }
  }

  if (!response.ok) {
    const message =
      data?.error?.description ||
      data?.error?.message ||
      data?.message ||
      `Razorpay request failed with status ${response.status}`

    const error = new Error(message)

    error.statusCode = response.status
    error.providerResponse = data

    throw error
  }

  return data
}

const normalizeAmountInPaise = amount => {
  const value = Number(amount)

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Valid payment amount is required')
  }

  return Math.round(value * 100)
}

const makeReferenceId = () => {
  return `PTV-${Date.now()}-${crypto
    .randomBytes(4)
    .toString('hex')
    .toUpperCase()}`
}

/**
 * Create Razorpay Route Linked Account.
 *
 * NOTE:
 * Route Linked Account onboarding/configuration can require
 * Razorpay product configuration/KYC steps.
 *
 * Do not assume that creating the account alone means it can
 * immediately receive transfers.
 */
const createLinkedAccount = async ({
  name,
  email,
  phone,
  referenceId,
  fetchImpl = global.fetch
}) => {
  const payload = {
    email,
    phone,
    type: 'route',
    reference_id: referenceId,
    legal_business_name: name,
    business_type: 'individual'
  }

  return razorpayRequest('/accounts', {
    method: 'POST',
    body: payload,
    fetchImpl
  })
}

/**
 * Create Payment Link with automatic Route transfer.
 *
 * Razorpay:
 * POST /v1/payment_links
 *
 * options.order.transfers tells Razorpay to automatically
 * transfer the captured payment to the Linked Account.
 */
const createPaymentLinkWithTransfer = async ({
  amount,
  currency = 'INR',
  referenceId,
  description,
  customer,
  routeAccountId,
  notes = {},
  expireBy,
  callbackUrl,
  fetchImpl = global.fetch
}) => {
  if (!routeAccountId) {
    throw new Error('Razorpay Route account ID is required')
  }

  if (currency !== 'INR') {
    throw new Error(
      'Razorpay automatic Payment Link transfers currently require INR'
    )
  }

  const amountInPaise = normalizeAmountInPaise(amount)

  const payload = {
    amount: amountInPaise,

    currency: 'INR',

    accept_partial: false,

    reference_id: referenceId || makeReferenceId(),

    description: description || 'Porttivo transporter payment',

    customer: {
      name: customer?.name || 'Porttivo Transporter',

      contact: customer?.contact || undefined,

      email: customer?.email || undefined
    },

    notify: {
      sms: false,
      email: Boolean(customer?.email)
    },

    reminder_enable: true,

    callback_url: callbackUrl || razorpayPaymentLinkWebhookUrl,

    callback_method: 'get',

    notes: {
      source: 'PORTTIVO',
      ...notes
    },

    options: {
      order: {
        transfers: [
          {
            account: routeAccountId,

            amount: amountInPaise,

            currency: 'INR',

            notes: {
              source: 'PORTTIVO'
            },

            linked_account_notes: ['source']
          }
        ]
      }
    }
  }

  if (expireBy) {
    payload.expire_by = expireBy
  }

  return razorpayRequest('/payment_links', {
    method: 'POST',
    body: payload,
    fetchImpl
  })
}

const fetchPaymentLink = async (paymentLinkId, fetchImpl = global.fetch) => {
  if (!paymentLinkId) {
    throw new Error('Payment Link ID is required')
  }

  return razorpayRequest(
    `/payment_links/${encodeURIComponent(paymentLinkId)}`,
    {
      method: 'GET',
      fetchImpl
    }
  )
}

const cancelPaymentLink = async (paymentLinkId, fetchImpl = global.fetch) => {
  return razorpayRequest(
    `/payment_links/${encodeURIComponent(paymentLinkId)}/cancel`,
    {
      method: 'POST',
      fetchImpl
    }
  )
}

// createPaymentLink
const createPaymentLink = async ({
  amount,
  currency = 'INR',
  referenceId,
  description,
  customer,
  expireBy,
  callbackUrl,
  notes,
  fetchImpl
}) => {
  const amountInPaise = normalizeAmountInPaise(amount)

  const payload = {
    amount: amountInPaise,
    currency,
    accept_partial: false,
    reference_id: referenceId,
    description,
    customer,
    notify: {
      sms: false,
      email: true
    },
    reminder_enable: true,
    notes
  }

  if (expireBy) {
    payload.expire_by = expireBy
  }

  if (callbackUrl) {
    payload.callback_url = callbackUrl
    payload.callback_method = 'get'
  }

  const result = await razorpayRequest('/payment_links', {
    method: 'POST',
    body: payload,
    fetchImpl
  })

  if (!result.ok) {
    throw new Error(
      result.data?.error?.description ||
        result.data?.message ||
        'Razorpay Payment Link creation failed'
    )
  }

  return result.data
}

module.exports = {
  razorpayRequest,
  createLinkedAccount,
  createPaymentLinkWithTransfer,
  fetchPaymentLink,
  cancelPaymentLink,
  normalizeAmountInPaise,
  makeReferenceId,
  createPaymentLink
}
