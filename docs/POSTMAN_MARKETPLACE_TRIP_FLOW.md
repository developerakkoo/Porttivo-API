# Marketplace Trip Flow for Postman Testing

This file documents the full marketplace trip payment flow with PayU and Cashfree, including API endpoints, request bodies, and payload examples.

## 1. Overview

A marketplace trip flow in this backend includes:

1. Trip created from a confirmed marketplace booking.
2. Trip starts and driver completes milestone 1.
3. Backend marks the trip as payment-eligible and emits a `marketplace:payment:ready` event.
4. Booking buyer transporter initiates PayU payment for the agreed price.
5. PayU callback/webhook updates the marketplace payment record.
6. On first PayU success, the backend triggers automatic Cashfree payout.

## 2. Base URL

Use the application base URL for your Postman environment.

Example:

```
{{baseUrl}}/api
```

## 3. Authentication

Authenticated endpoints require a bearer token header.

Headers:

```
Authorization: Bearer {{accessToken}}
Content-Type: application/json
```

## 4. Routes

### 4.1 Complete Milestone 1 (Driver)

Endpoint:

```
POST /api/trips/:id/milestones/:milestoneNumber
```

Description:

- Called by the driver assigned to the trip.
- When `milestoneNumber` is `1` for a marketplace trip, the backend will also create a marketplace payment request and mark the trip as ready for payment.

Request body example:

```json
{
  "latitude": 12.9716,
  "longitude": 77.5946
}
```

Notes:

- Use `milestoneNumber` = `1`.
- If the driver uploads milestone photos, the route can accept multipart uploads, but for basic flow only latitude/longitude is required.

### 4.2 Initiate Razorpay Payment (Booking Buyer)

Endpoint:

```
POST /api/marketplace-payments/trips/:tripId/razorpay/initiate
```

Description:

- Buyer transporter calls this after milestone 1 completion.
- Creates or returns the latest pending `MarketplacePayment` for the trip.
- Returns Razorpay checkout request data.

Request body example:

```json
{
  "payerName": "Buyer Transporter",
  "payerEmail": "buyer@example.com",
  "payerPhone": "9999999999"
}
```

Success response example:

```json
{
  "success": true,
  "message": "Razorpay payment request created successfully",
  "data": {
    "payment": {
      "id": "64d1f2c6d00bf23a6e0f8d9e",
      "paymentId": "64d1f2c6d00bf23a6e0f8d9e",
      "publicId": "64d1f2c6d00bf23a6e0f8d9e",
      "tripId": "64d1f2c6d00bf23a6e0f8d9b",
      "bookingId": "64d1f2c6d00bf23a6e0f8d99",
      "status": "PENDING",
      "amount": 12500,
      "currency": "INR",
      "merchantTransactionId": "RZP-TRIP-123",
      "providerOrderId": "order_123",
      "actionUrl": "https://checkout.razorpay.com/v1/checkout.js",
      "method": "GET",
      "fields": {
        "key": "rzp_live_...",
        "order_id": "order_123",
        "amount": 1250000,
        "currency": "INR",
        "name": "Buyer Transporter",
        "description": "Marketplace trip TRIP-ABC123",
        "prefill": {
          "name": "Buyer Transporter",
          "email": "buyer@example.com",
          "contact": "9999999999"
        },
        "callback_url": "https://your-api.example.com/api/marketplace-payments/razorpay/webhook",
        "redirect": false
      }
    },
    "gateway": {
      "provider": "RAZORPAY",
      "name": "Razorpay",
      "mode": "sandbox",
      "actionUrl": "https://checkout.razorpay.com/v1/checkout.js",
      "method": "GET"
    }
  }
}
```

### 4.3 Check Marketplace Payment Status

Endpoint:

```
GET /api/marketplace-payments/trips/:tripId/razorpay/status
```

Description:

- Returns the latest marketplace payment status and eligibility flags.
- Useful for UI refresh after milestone completion or before payment initiation.

Response structure:

```json
{
  "success": true,
  "data": {
    "trip": {
      "id": "64d1f2c6d00bf23a6e0f8d9b",
      "tripId": "TRIP-ABC123",
      "status": "ACTIVE",
      "isFromBooking": true,
      "bookingId": "64d1f2c6d00bf23a6e0f8d99",
      "tripType": "IMPORT"
    },
    "booking": {
      "id": "64d1f2c6d00bf23a6e0f8d99",
      "buyerId": "buyer-1",
      "sellerId": "seller-1",
      "agreedPrice": 12500,
      "paymentStatus": "HOLD"
    },
    "payment": {
      "_id": "64d1f2c6d00bf23a6e0f8d9e",
      "status": "PENDING",
      "amount": 12500,
      "currency": "INR",
      "merchantTransactionId": "PAYU-TRIP-123",
      "providerTransactionId": null,
      "providerOrderId": null
    },
    "eligibility": {
      "marketplaceTrip": true,
      "tripStarted": true,
      "milestoneOneCompleted": true,
      "canInitiatePayment": true
    }
  }
}
```

## 5. Razorpay Webhook / Callback

Endpoint:

```
POST /api/marketplace-payments/razorpay/webhook
GET /api/marketplace-payments/razorpay/webhook
```

Description:

- Receives Razorpay callback or redirect after payment.
- Verifies Razorpay signature.
- Updates `MarketplacePayment` status.
- Updates `VehicleBooking.paymentStatus`.
- Triggers automatic Cashfree payout on first successful payment.

Example Razorpay request body:

```json
{
  "razorpay_order_id": "order_123",
  "razorpay_payment_id": "pay_123",
  "razorpay_signature": "..."
}
```

Response example:

```json
{
  "success": true,
  "message": "Marketplace Razorpay webhook processed successfully"
}
```

Notes:

- `udf1` is used to store the marketplace payment ID when available.
- The backend ignores duplicate Razorpay success notifications if the payment is already marked `SUCCESS`.

## 6. Expected Marketplace Trip Data Flow

### 6.1 Precondition

- `VehicleBooking.status` must be `CONFIRMED` or `COMPLETED`.
- `VehicleBooking.agreedPrice` must be a valid number > 0.
- Trip must be marked `isFromBooking` and have `bookingId`.

### 6.2 Trip Lifecycle

1. Driver starts trip and completes milestone 1.
2. Backend creates marketplace payment request and broadcasts readiness.
3. Buyer uses `POST /api/marketplace-payments/trips/:tripId/razorpay/initiate` to get Razorpay checkout details.
4. Buyer completes payment in Razorpay checkout.
5. Razorpay calls back to `/api/marketplace-payments/razorpay/webhook`.
6. If payment is `SUCCESS`:
   - `MarketplacePayment.status` becomes `SUCCESS`
   - `VehicleBooking.paymentStatus` becomes `COMPLETED`
   - Cashfree payout is initiated automatically
   - A notification may be created for the buyer transporter

### 6.3 Post-payment

- The UI should poll or refresh `/api/marketplace-payments/trips/:tripId/razorpay/status` to display payment completion.
- The buyer transporter sees `canInitiatePayment: false` after success.
- The booking payment status moves from `HOLD`/`PENDING` to `COMPLETED`.

## 7. Postman Test Cases

1. Complete milestone 1 for a marketplace trip.
2. Verify payment readiness by calling `GET /api/marketplace-payments/trips/:tripId/razorpay/status`.
3. Initiate Razorpay payment with `POST /api/marketplace-payments/trips/:tripId/razorpay/initiate`.
4. Simulate Razorpay webhook with `POST /api/marketplace-payments/razorpay/webhook`.
5. Confirm `MarketplacePayment.status` is `SUCCESS` and `booking.paymentStatus` becomes `COMPLETED`.



## 9. Field reference

### Marketplace payment record

- `amount`: final PayU amount from booking agreed price
- `currency`: usually `INR`
- `merchantTransactionId`: PayU transaction ID used for lookup
- `providerTransactionId`: transaction ID returned by PayU (`mihpayid`)
- `paymentRequest.actionUrl`: PayU endpoint URL
- `paymentRequest.fields`: required PayU form fields

### Booking record

- `agreedPrice`: final marketplace negotiated price
- `paymentStatus`: updated to `COMPLETED` on success

### Trip record

- `isFromBooking`: true for marketplace trips
- `bookingId`: reference to the booking
- `milestones`: milestone 1 must be completed before payment

---

Use this document in Postman as a guide for each marketplace trip payment step, including sample requests and expected result states.
