require('dotenv').config();

const getPublicApiBaseUrl = () => {
  const raw =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.SERVER_URL ||
    process.env.API_BASE_URL ||
    process.env.BACKEND_URL ||
    ''

  const normalized = String(raw).trim().replace(/\/+$/, '')
  if (normalized) {
    return normalized
  }

  if (
    process.env.NODE_ENV === 'development' ||
    String(process.env.CASHFREE_USE_LOCAL_URL || '').trim().toLowerCase() === 'true'
  ) {
    return ''
  }

  return 'https://api.port.porttivo.com'
}

const publicApiBaseUrl = getPublicApiBaseUrl()
const buildApiUrl = (path) => {
  if (publicApiBaseUrl) {
    return `${publicApiBaseUrl}${path}`
  }

  return `http://localhost:${process.env.PORT || 3000}${path}`
}

module.exports = {
  port: process.env.PORT || 3000,
  /** Engine.IO path; must match Flutter `SOCKET_IO_PATH` / nginx when using a subpath (e.g. `/api/socket.io`). */
  socketIoPath: process.env.SOCKET_IO_PATH || '/socket.io',
  mongodbUri: process.env.MONGODB_URI || 'mongodb+srv://shubhamshelke6103_db:shubhamshelke@cluster0.23riiuz.mongodb.net/porttivo?appName=Cluster0',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  watiApiEndpoint: process.env.WATI_API_ENDPOINT || 'https://live-mt-server.wati.io/10105134',
  watiBearerToken: process.env.WATI_BEARER_TOKEN || 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6ImZpbmFuY2VAcG9ydHRpdm8uY29tIiwibmFtZWlkIjoiZmluYW5jZUBwb3J0dGl2by5jb20iLCJlbWFpbCI6ImZpbmFuY2VAcG9ydHRpdm8uY29tIiwiYXV0aF90aW1lIjoiMDMvMTMvMjAyNiAwODowNzowOSIsInRlbmFudF9pZCI6IjEwMTA1MTM0IiwiZGJfbmFtZSI6Im10LXByb2QtVGVuYW50cyIsImh0dHA6Ly9zY2hlbWFzLm1pY3Jvc29mdC5jb20vd3MvMjAwOC8wNi9pZGVudGl0eS9jbGFpbXMvcm9sZSI6IkFETUlOSVNUUkFUT1IiLCJleHAiOjI1MzQwMjMwMDgwMCwiaXNzIjoiQ2xhcmVfQUkiLCJhdWQiOiJDbGFyZV9BSSJ9.JUUjmcXwmp2d68IzM1HyFKeDp2VewosdvE4ki_6p0l4',
  watiDefaultCountryCode: process.env.WATI_DEFAULT_COUNTRY_CODE || '91',
  watiBroadcastPrefix: process.env.WATI_BROADCAST_PREFIX || 'porttivo',
  surepassRcFullUrl: process.env.SUREPASS_RC_FULL_URL || 'https://sandbox.surepass.app/api/v1/rc/rc-full',
  surepassApiToken: process.env.SUREPASS_API_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc4MzA2NjY4MiwianRpIjoiYTRkNzIwNmYtMGYwNy00MWYxLWEwMGQtYjM3OTQzOTk0N2JlIiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmZpbmFuY2VfMTQ4NTYxQHN1cmVwYXNzLmlvIiwibmJmIjoxNzgzMDY2NjgyLCJleHAiOjE3ODU2NTg2ODIsImVtYWlsIjoiZmluYW5jZV8xNDg1NjFAc3VyZXBhc3MuaW8iLCJ0ZW5hbnRfaWQiOiJtYWluIiwidXNlcl9jbGFpbXMiOnsic2NvcGVzIjpbInVzZXIiXX19.k-jyMC6OR92QDDYmfkP0zGnXcr-BY5LK7r5gMcy0IOI',
  surepassRequestTimeoutMs: Number(process.env.SUREPASS_REQUEST_TIMEOUT_MS || 10000),
  payuMode: process.env.PAYU_MODE || 'sandbox',
  payuKey: process.env.PAYU_KEY || 'twIHLx',
  payuSalt: process.env.PAYU_SALT || 'Hu0hwsqnioAkcUzuvvS0CuDoqPZB1HPm',
  payuClientId: process.env.PAYU_CLIENT_ID || '526c53443ef3c4d2052abbe9bea907bd2bf5da0fbcbe19703b8f31dad21627a8',
  payuClientSecret: process.env.PAYU_CLIENT_SECRET || 'd634b93ded0b5897a6d59e05716e8578e15b2dbb14c0c4f5fdcb25dd1295525d',
  payuCheckoutUrl:
    process.env.PAYU_CHECKOUT_URL ||
    (process.env.PAYU_MODE === 'production'
      ? 'https://secure.payu.in/_payment'
      : 'https://test.payu.in/_payment'),
  payuSuccessUrl:
    process.env.PAYU_SUCCESS_URL ||
    buildApiUrl('/api/marketplace-payments/payu/webhook'),
  payuFailureUrl:
    process.env.PAYU_FAILURE_URL ||
    buildApiUrl('/api/marketplace-payments/payu/webhook'),
  payuWebhookUrl:
    process.env.PAYU_WEBHOOK_URL ||
    buildApiUrl('/api/marketplace-payments/payu/webhook'),
  payuPaymentLinksUrl: process.env.PAYU_PAYMENT_LINKS_URL || '',
  paymentScreenPayuSuccessUrl:
    process.env.PAYMENT_SCREEN_PAYU_SUCCESS_URL ||
    buildApiUrl('/api/payments/payu/webhook'),
  paymentScreenPayuFailureUrl:
    process.env.PAYMENT_SCREEN_PAYU_FAILURE_URL ||
    buildApiUrl('/api/payments/payu/webhook'),
  paymentScreenPayuWebhookUrl:
    process.env.PAYMENT_SCREEN_PAYU_WEBHOOK_URL ||
    buildApiUrl('/api/payments/payu/webhook'),
  cashfreeMode: process.env.CASHFREE_MODE || 'sandbox',
  cashfreeClientId: process.env.CASHFREE_CLIENT_ID || 'TEST109808845e5fe00f7bbaa0e9aeb148808901',
  cashfreeClientSecret: process.env.CASHFREE_CLIENT_SECRET || 'cfsk_ma_test_20d8ab0f51dfd4cc60943d425cbeb11c_a45d1b9c',
  cashfreeWebhookSecret: process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_CLIENT_SECRET || '',
  cashfreeApiVersion: process.env.CASHFREE_API_VERSION || '2023-08-01',
  cashfreeWebhookStrictValidation:
    String(process.env.CASHFREE_WEBHOOK_STRICT_VALIDATION || '').trim().toLowerCase() === 'true',
  cashfreeApiBaseUrl:
    process.env.CASHFREE_API_BASE_URL ||
    (process.env.CASHFREE_MODE === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg'),
  cashfreePayoutMode: process.env.CASHFREE_PAYOUT_MODE || process.env.CASHFREE_MODE || 'sandbox',
  cashfreePayoutClientId: process.env.CASHFREE_PAYOUT_CLIENT_ID || process.env.CASHFREE_CLIENT_ID || 'CF10980884D98EI779710S73ALJ92G',
  cashfreePayoutClientSecret: process.env.CASHFREE_PAYOUT_CLIENT_SECRET || process.env.CASHFREE_CLIENT_SECRET || 'cfsk_ma_test_16860af5b9153a32a339e7ca2f23be97_a06e1672',
  cashfreePayoutWebhookSecret:
    process.env.CASHFREE_PAYOUT_WEBHOOK_SECRET ||
    process.env.CASHFREE_WEBHOOK_SECRET ||
    process.env.CASHFREE_CLIENT_SECRET ||
    'cfsk_ma_test_91717ea9b403acaa67b1904f3e05af66_48ece372',
  cashfreePayoutApiBaseUrl:
    process.env.CASHFREE_PAYOUT_API_BASE_URL ||
    'https://sandbox.cashfree.com/payout',
  cashfreePayoutWebhookStrictValidation:
    String(process.env.CASHFREE_PAYOUT_WEBHOOK_STRICT_VALIDATION || '').trim().toLowerCase() === 'true',
  cashfreePayoutWebhookUrl:
    process.env.CASHFREE_PAYOUT_WEBHOOK_URL ||
    buildApiUrl('/api/payouts/cashfree/webhook'),
  cashfreePayoutBankEncryptionSecret:
    process.env.CASHFREE_PAYOUT_ENCRYPTION_KEY ||
    process.env.CASHFREE_PAYOUT_BANK_ENCRYPTION_SECRET ||
    process.env.CASHFREE_CLIENT_SECRET ||
    '6c30290bdceae775683562ffd7b02e8792fd528699f0ade349573531ec4c5918',
  cashfreeCheckoutUrl:
    process.env.CASHFREE_CHECKOUT_URL ||
    (process.env.CASHFREE_MODE === 'production'
      ? 'https://payments.cashfree.com/checkout'
      : 'https://sandbox.cashfree.com/checkout'),
  cashfreeReturnUrl:
    process.env.CASHFREE_RETURN_URL ||
    buildApiUrl('/api/payments/cashfree/return'),
  cashfreeWebhookUrl:
    process.env.CASHFREE_WEBHOOK_URL ||
    buildApiUrl('/api/payments/cashfree/webhook'),
};
