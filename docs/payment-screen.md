# General Payment Screen

This backend adds a reusable payment layer for a common payment screen that can start either PayU or Cashfree checkout flows.

## Endpoints

### 1. List available gateways

`GET /api/payments/gateways`

Returns:

- supported providers
- which providers are configured
- the default currency

### 2. Create a payment session

`POST /api/payments/sessions`

Authentication: required

Body:

```json
{
  "provider": "PAYU",
  "amount": 1250,
  "currency": "INR",
  "purpose": "Invoice payment",
  "referenceType": "INVOICE",
  "referenceId": "INV-1001",
  "payer": {
    "name": "Alpha Logistics",
    "email": "alpha@example.com",
    "mobile": "9999999999"
  }
}
```

Response includes:

- normalized payment session
- provider metadata
- provider checkout payload

### 3. Fetch session status

`GET /api/payments/sessions/:id`

Authentication: required

Use this to refresh the screen after redirect or webhook completion.

### 4. Fetch by reference

`GET /api/payments/references/:referenceType/:referenceId?provider=PAYU`

Authentication: required

Useful when the screen already knows the business reference but not the payment session id.

### 5. Gateway webhooks

`POST /api/payments/payu/webhook`

`GET /api/payments/payu/webhook`

`POST /api/payments/cashfree/webhook`

`GET /api/payments/cashfree/webhook`

These endpoints update the payment session status after provider callbacks.

## Screen Flow

1. Load `/api/payments/gateways`.
2. Show the available providers on the payment screen.
3. Collect the provider choice and payment reference.
4. Call `POST /api/payments/sessions`.
5. Redirect or open the provider checkout payload returned by the API.
6. Poll `GET /api/payments/sessions/:id` after callback completion.

## Supported Status Values

- `CREATED`
- `PENDING`
- `SUCCESS`
- `FAILED`
- `CANCELLED`
- `REFUNDED`

## Environment Variables

### PayU

- `PAYU_MODE`
- `PAYU_KEY`
- `PAYU_SALT`
- `PAYU_CLIENT_ID`
- `PAYU_CLIENT_SECRET`
- `PAYU_CHECKOUT_URL`
- `PAYU_SUCCESS_URL`
- `PAYU_FAILURE_URL`
- `PAYU_WEBHOOK_URL`
- `PAYU_PAYMENT_LINKS_URL`

### Cashfree

- `CASHFREE_MODE`
- `CASHFREE_CLIENT_ID`
- `CASHFREE_CLIENT_SECRET`
- `CASHFREE_WEBHOOK_SECRET`
- `CASHFREE_API_VERSION`
- `CASHFREE_API_BASE_URL`
- `CASHFREE_CHECKOUT_URL`
- `CASHFREE_RETURN_URL`
- `CASHFREE_WEBHOOK_URL`

## Notes

- The payment screen is backend-agnostic and can be used for any reference type.
- Existing marketplace-trip payment code remains intact.
- The frontend should treat the provider response as the source of truth for redirect or hosted checkout behavior.
