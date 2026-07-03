require('dotenv').config();

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
    `http://localhost:${process.env.PORT || 3000}/api/marketplace-payments/payu/webhook`,
  payuFailureUrl:
    process.env.PAYU_FAILURE_URL ||
    `http://localhost:${process.env.PORT || 3000}/api/marketplace-payments/payu/webhook`,
  payuWebhookUrl:
    process.env.PAYU_WEBHOOK_URL ||
    `http://localhost:${process.env.PORT || 3000}/api/marketplace-payments/payu/webhook`,
  payuPaymentLinksUrl: process.env.PAYU_PAYMENT_LINKS_URL || '',
  paymentScreenPayuSuccessUrl:
    process.env.PAYMENT_SCREEN_PAYU_SUCCESS_URL ||
    `http://localhost:${process.env.PORT || 3000}/api/payments/payu/webhook`,
  paymentScreenPayuFailureUrl:
    process.env.PAYMENT_SCREEN_PAYU_FAILURE_URL ||
    `http://localhost:${process.env.PORT || 3000}/api/payments/payu/webhook`,
  paymentScreenPayuWebhookUrl:
    process.env.PAYMENT_SCREEN_PAYU_WEBHOOK_URL ||
    `http://localhost:${process.env.PORT || 3000}/api/payments/payu/webhook`,
  cashfreeMode: process.env.CASHFREE_MODE || 'sandbox',
  cashfreeClientId: process.env.CASHFREE_CLIENT_ID || 'TEST109808845e5fe00f7bbaa0e9aeb148808901',
  cashfreeClientSecret: process.env.CASHFREE_CLIENT_SECRET || 'cfsk_ma_test_9bcfa79b624f3de0e0e7699c5eb37bd1_6cf1ef64',
  cashfreeWebhookSecret: process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_CLIENT_SECRET || '',
  cashfreeApiVersion: process.env.CASHFREE_API_VERSION || '2023-08-01',
  cashfreeApiBaseUrl:
    process.env.CASHFREE_API_BASE_URL ||
    (process.env.CASHFREE_MODE === 'production'
      ? 'https://api.cashfree.com/pg'
      : 'https://sandbox.cashfree.com/pg'),
  cashfreeCheckoutUrl:
    process.env.CASHFREE_CHECKOUT_URL ||
    (process.env.CASHFREE_MODE === 'production'
      ? 'https://payments.cashfree.com/checkout'
      : 'https://sandbox.cashfree.com/checkout'),
  cashfreeReturnUrl:
    process.env.CASHFREE_RETURN_URL ||
    `http://localhost:${process.env.PORT || 3000}/api/payments/cashfree/webhook`,
  cashfreeWebhookUrl:
    process.env.CASHFREE_WEBHOOK_URL ||
    `http://localhost:${process.env.PORT || 3000}/api/payments/cashfree/webhook`,
};
