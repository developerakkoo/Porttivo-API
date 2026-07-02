# Marketplace Trip PayU Payment Handoff

This document describes the end-to-end PayU PayIN flow for marketplace trips only, from payment eligibility to UI-facing status updates.

## Scope

- Applies only to marketplace trips created from a confirmed booking.
- Uses the booking's final negotiated price as the payable amount.
- Allows payment only after:
  - the trip has started
  - milestone 1 is completed
  - the booking is confirmed
- The booking buyer transporter initiates payment.
- Payment collection is separate from payout/disbursement to the transporter.

## Business Flow

1. Booking negotiation completes and `VehicleBooking.agreedPrice` is set.
2. The booking is confirmed and a trip exists from that booking.
3. The trip starts.
4. Driver completes milestone 1.
5. Backend marks the trip as payment-eligible and emits a real-time event.
6. Buyer transporter initiates PayU PayIN.
7. PayU callback/webhook updates payment status.
8. Trip and booking payment status are updated for UI consumption.

## New Backend Components

- `MarketplacePayment` model
- PayU signing and verification service
- Marketplace payment controller and routes
- Marketplace payment snapshot service
- Marketplace payment ready notification helper

## Important Backend Fields

### Booking

- `VehicleBooking.agreedPrice`
- `VehicleBooking.paymentStatus`

### Trip

- `Trip.isFromBooking`
- `Trip.bookingId`
- `Trip.status`
- `Trip.milestones`

### Payment record

- `MarketplacePayment.status`
- `MarketplacePayment.amount`
- `MarketplacePayment.merchantTransactionId`
- `MarketplacePayment.providerTransactionId`
- `MarketplacePayment.providerOrderId`
- `MarketplacePayment.paymentRequest`
- `MarketplacePayment.paymentResponse`

## Routes

### 1. Initiate PayU PayIN

`POST /api/marketplace-payments/trips/:tripId/payu/initiate`

Authentication:

- Required

Who can call:

- Marketplace booking buyer transporter only

Request body:

```json
{
  "payerName": "Optional override",
  "payerEmail": "buyer@example.com",
  "payerPhone": "9999999999"
}
```

Rules:

- Trip must be a marketplace trip.
- Trip must be `ACTIVE`.
- Milestone 1 must already be completed.
- Booking must be `CONFIRMED`.
- `agreedPrice` must be present and greater than 0.

Success response includes:

- PayU checkout URL
- PayU form fields
- merchant transaction id
- payment status

### 2. Payment Status

`GET /api/marketplace-payments/trips/:tripId/payu/status`

Authentication:

- Required

Who can call:

- Buyer transporter
- Seller transporter
- Admin

Response includes:

- trip summary
- booking summary
- latest marketplace payment record
- eligibility flags

### 3. PayU Webhook / Callback

`POST /api/marketplace-payments/payu/webhook`

`GET /api/marketplace-payments/payu/webhook`

Authentication:

- None

Purpose:

- Receives PayU callback or redirect payload
- Verifies PayU response hash
- Updates `MarketplacePayment`
- Updates `VehicleBooking.paymentStatus`

Note:

- Both `GET` and `POST` are accepted so the same endpoint can handle provider redirects and server callbacks.

### 4. Existing Milestone Route

`POST /api/trips/:id/milestones/:milestoneNumber`

Authentication:

- Required

Who can call:

- Driver assigned to the trip

Important behavior:

- When `milestoneNumber === 1` on a marketplace trip, backend emits a `marketplace:payment:ready` socket event and sends notifications.

### 5. Existing Trip Detail Route

`GET /api/trips/:id`

Authentication:

- Required

Important behavior:

- Marketplace trips now include a `marketplacePayment` object in the response.

## Trip Detail Response Shape

For marketplace trips, `GET /api/trips/:id` now includes:

```json
{
  "marketplacePayment": {
    "marketplaceTrip": true,
    "tripId": "trip_object_id",
    "tripPublicId": "TRIP-ABC123",
    "bookingId": "booking_object_id",
    "payerTransporterId": "buyer_transporter_id",
    "beneficiaryTransporterId": "seller_transporter_id",
    "agreedPrice": 12500,
    "paymentStatus": "PENDING",
    "tripStarted": true,
    "milestoneOneCompleted": true,
    "payment": {
      "id": "payment_object_id",
      "status": "PENDING",
      "amount": 12500,
      "currency": "INR",
      "merchantTransactionId": "PTV-xxxxx",
      "providerTransactionId": null,
      "providerOrderId": null,
      "completedAt": null,
      "failedAt": null
    },
    "eligibility": {
      "marketplaceTrip": true,
      "tripStarted": true,
      "milestoneOneCompleted": true,
      "bookingConfirmed": true,
      "hasAgreedPrice": true,
      "canInitiatePayment": true
    }
  }
}
```

## Socket Events

### 1. Payment Ready Event

Event name:

`marketplace:payment:ready`

Emitted when:

- milestone 1 is completed on a marketplace trip

Recipients:

- buyer transporter room
- seller transporter room
- trip room
- admin room

Payload:

```json
{
  "trip": {},
  "payment": {
    "marketplaceTrip": true,
    "tripId": "trip_object_id",
    "tripPublicId": "TRIP-ABC123",
    "bookingId": "booking_object_id",
    "payerTransporterId": "buyer_transporter_id",
    "beneficiaryTransporterId": "seller_transporter_id",
    "agreedPrice": 12500,
    "paymentStatus": "PENDING",
    "tripStarted": true,
    "milestoneOneCompleted": true,
    "eligibility": {
      "canInitiatePayment": true
    },
    "source": "milestone_1_complete"
  },
  "message": "Marketplace payment is now available."
}
```

### 2. Existing Trip Milestone Event

Event name:

`trip:milestone:updated`

Emitted for all milestone updates, including milestone 1.

## Frontend Decision Points

Use these checks to show the Pay Now button:

- `trip.marketplacePayment.eligibility.canInitiatePayment === true`
- `trip.marketplacePayment.paymentStatus !== "SUCCESS"`

Recommended UI behavior:

- Hide payment actions until `canInitiatePayment` is true.
- Show a Pay Now CTA when the socket event `marketplace:payment:ready` arrives.
- Re-fetch trip details or payment status after redirect/callback completion.

## PayU Request Notes

When initiating payment, backend returns:

- `actionUrl`
- `method`
- `fields`

The frontend should render a standard PayU form POST using those fields.

Important fields returned in the PayU payload:

- `key`
- `txnid`
- `amount`
- `productinfo`
- `firstname`
- `email`
- `phone`
- `surl`
- `furl`
- `hash`
- `service_provider`

## Payment Status Values

Marketplace payment record status:

- `CREATED`
- `PENDING`
- `SUCCESS`
- `FAILED`
- `CANCELLED`
- `REFUNDED`

Booking payment status values used by this flow:

- `PENDING`
- `HOLD`
- `COMPLETED`

## Environment Variables

Set these values for PayU:

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

## Implementation Files

- [`src/models/MarketplacePayment.js`](../src/models/MarketplacePayment.js)
- [`src/services/payu.service.js`](../src/services/payu.service.js)
- [`src/services/marketplacePayment.service.js`](../src/services/marketplacePayment.service.js)
- [`src/utils/marketplacePaymentNotification.js`](../src/utils/marketplacePaymentNotification.js)
- [`src/controllers/marketplacePayment.controller.js`](../src/controllers/marketplacePayment.controller.js)
- [`src/routes/marketplacePayment.routes.js`](../src/routes/marketplacePayment.routes.js)
- [`src/controllers/tripMilestone.controller.js`](../src/controllers/tripMilestone.controller.js)
- [`src/controllers/trip.controller.js`](../src/controllers/trip.controller.js)
- [`src/services/socket.service.js`](../src/services/socket.service.js)

## Suggested Frontend Flow

1. Open trip details with `GET /api/trips/:id`.
2. Read `marketplacePayment.eligibility`.
3. If `canInitiatePayment` is true, show the Pay Now button.
4. On click, call `POST /api/marketplace-payments/trips/:tripId/payu/initiate`.
5. Render the PayU form using the returned `actionUrl` and `fields`.
6. After PayU redirects back or the webhook completes, refresh:
   - `GET /api/trips/:id`
   - `GET /api/marketplace-payments/trips/:tripId/payu/status`
7. Listen for `marketplace:payment:ready` to refresh the UI immediately when milestone 1 completes.

## Notes

- This is intentionally limited to marketplace trips.
- It does not trigger transporter payout automatically.
- The backend treats `VehicleBooking.agreedPrice` as the final payment amount.
