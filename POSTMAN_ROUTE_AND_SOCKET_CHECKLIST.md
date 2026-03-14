# Porttivo Postman Route And Socket Checklist

## Base Setup

- Base URL: `http://localhost:{{port}}`
- Health: `GET /health`
- API Base: `{{baseUrl}}/api`

## Postman Environment Variables

Create these variables first:

- `baseUrl`
- `adminToken`
- `transporterToken`
- `companyUserToken`
- `driverToken`
- `customerToken`
- `pumpOwnerToken`
- `pumpStaffToken`
- `vehicleId`
- `driverId`
- `tripId`
- `tripMongoId`
- `customerTripId`
- `fuelCardId`
- `fuelTransactionId`
- `cashReceiptId`
- `settlementId`
- `sharedToken`

## Auth Requests

### Admin Login
`POST {{baseUrl}}/api/auth/admin-login`

```json
{
  "email": "admin@example.com",
  "password": "Admin@123"
}
```

Save access token to `adminToken`.

### Transporter Login
`POST {{baseUrl}}/api/auth/pin-login`

```json
{
  "mobile": "9999999999",
  "pin": "1234"
}
```

Save access token to `transporterToken`.

### Company User Login
`POST {{baseUrl}}/api/auth/company-user-login`

```json
{
  "mobile": "9999999998",
  "pin": "1234"
}
```

Save access token to `companyUserToken`.

### Customer Login
`POST {{baseUrl}}/api/auth/customer/mobile`

```json
{
  "mobile": "9999999997",
  "name": "Customer One"
}
```

Save access token to `customerToken`.

## Core Master Data

Use `Authorization: Bearer {{transporterToken}}`

### Create Driver
`POST {{baseUrl}}/api/drivers`

```json
{
  "name": "Driver One",
  "mobile": "9999999996",
  "language": "en"
}
```

Save returned `_id` as `driverId`.

### Create Vehicle
`POST {{baseUrl}}/api/vehicles`

```json
{
  "vehicleNumber": "MH01AB1234",
  "trailerType": "40FT",
  "ownerType": "OWN"
}
```

Save returned `_id` as `vehicleId`.

## Full Trip Backbone

### 1. Customer Booking
Use `Authorization: Bearer {{customerToken}}`

`POST {{baseUrl}}/api/trips/customer/book`

```json
{
  "tripType": "IMPORT",
  "containerNumber": "CONT-1001",
  "reference": "CUST-BOOK-1",
  "pickupLocation": {
    "address": "JNPT",
    "coordinates": { "latitude": 18.95, "longitude": 72.95 },
    "city": "Navi Mumbai",
    "state": "MH"
  },
  "dropLocation": {
    "address": "Pune Warehouse",
    "coordinates": { "latitude": 18.52, "longitude": 73.85 },
    "city": "Pune",
    "state": "MH"
  }
}
```

Save `_id` as `customerTripId`.

### 2. Transporter View Available Customer Trips
Use `Authorization: Bearer {{transporterToken}}`

- `GET {{baseUrl}}/api/trips/customer/available`

### 3. Accept Customer Trip
`PUT {{baseUrl}}/api/trips/{{customerTripId}}/accept`

### 4. Assign Vehicle
`PUT {{baseUrl}}/api/trips/{{customerTripId}}/assign-vehicle`

```json
{
  "vehicleId": "{{vehicleId}}"
}
```

### 5. Assign Driver
`PUT {{baseUrl}}/api/trips/{{customerTripId}}/assign-driver`

```json
{
  "driverId": "{{driverId}}"
}
```

### 6. Get Trip
- `GET {{baseUrl}}/api/trips/{{customerTripId}}`
- `GET {{baseUrl}}/api/trips/{{customerTripId}}/timeline`

### 7. Start Trip
Use `Authorization: Bearer {{driverToken}}`

`PUT {{baseUrl}}/api/trips/{{customerTripId}}/start`

### 8. Milestones
Use `Authorization: Bearer {{driverToken}}`

`POST {{baseUrl}}/api/trips/{{customerTripId}}/milestones/1`

Form-data:
- `latitude`: `18.95`
- `longitude`: `72.95`
- `photo`: file optional if rule not mandatory

Repeat for milestone `2`, `3`, `4`, `5`.

### 9. POD Upload
Use `Authorization: Bearer {{driverToken}}`

`POST {{baseUrl}}/api/trips/{{customerTripId}}/pod`

Form-data:
- `photo`: file

### 10. POD Approve
Use `Authorization: Bearer {{transporterToken}}`

`PUT {{baseUrl}}/api/trips/{{customerTripId}}/pod/approve`

### 11. Share Link
Use `Authorization: Bearer {{transporterToken}}`

`POST {{baseUrl}}/api/trips/{{customerTripId}}/share`

```json
{
  "linkType": "TRIP_VISIBILITY",
  "visibilityMode": "STATUS_ONLY",
  "expiryHours": 24
}
```

Save `shareToken`.

### 12. Shared Visibility Check
- `GET {{baseUrl}}/api/trips/shared/{{sharedToken}}`
- `GET {{baseUrl}}/api/trips/shared/{{sharedToken}}/view`

## Customer Visibility Checks

### Customer My Trips
Use `Authorization: Bearer {{customerToken}}`

- `GET {{baseUrl}}/api/trips/customer/my-trips`
- `GET {{baseUrl}}/api/trips/{{customerTripId}}`

Check:
- payer customer -> full execution data
- shared link -> filtered data
- origin pickup link -> only origin pickup view

## Wallet And Fuel Flow

### Transporter Wallet Top-up
Use `Authorization: Bearer {{transporterToken}}`

`POST {{baseUrl}}/api/wallets/add-money`

```json
{
  "amount": 5000
}
```

### Wallet Balance
- `GET {{baseUrl}}/api/wallets/balance`
- `GET {{baseUrl}}/api/wallets/transactions`

### Admin Create Fuel Card
Use `Authorization: Bearer {{adminToken}}`

`POST {{baseUrl}}/api/fuel-cards`

```json
{
  "cardNumber": "CARD1001",
  "transporterId": "{{transporterId}}"
}
```

Save `_id` as `fuelCardId`.

### Assign Fuel Card
Use `Authorization: Bearer {{transporterToken}}`

`PUT {{baseUrl}}/api/fuel-cards/{{fuelCardId}}/assign`

```json
{
  "driverId": "{{driverId}}"
}
```

### Driver Generate Fuel QR
Use `Authorization: Bearer {{driverToken}}`

`POST {{baseUrl}}/api/fuel/generate-qr`

```json
{
  "vehicleNumber": "MH01AB1234",
  "amount": 1000,
  "latitude": 18.95,
  "longitude": 72.95
}
```

Save transaction `_id` as `fuelTransactionId`.

### Driver Confirm
`POST {{baseUrl}}/api/fuel/confirm`

```json
{
  "transactionId": "{{fuelTransactionId}}",
  "amount": 1000
}
```

### Pump Staff Submit
Use `Authorization: Bearer {{pumpStaffToken}}`

`POST {{baseUrl}}/api/fuel/submit`

```json
{
  "qrCode": "{{qrCodeFromGenerateResponse}}",
  "amount": 1000,
  "latitude": 18.95,
  "longitude": 72.95,
  "pumpOwnerId": "{{pumpOwnerId}}"
}
```

### Fuel Transaction Checks
- `GET {{baseUrl}}/api/fuel/transactions`
- `GET {{baseUrl}}/api/fuel/transactions/{{fuelTransactionId}}`
- `GET {{baseUrl}}/api/fuel-cards/{{fuelCardId}}/transactions`

## Cash Fuel Receipt Review

### Driver Submit Cash Receipt
Use `Authorization: Bearer {{driverToken}}`

`POST {{baseUrl}}/api/fuel/cash-receipts`

Form-data:
- `amount`: `800`
- `vehicleNumber`: `MH01AB1234`
- `latitude`: `18.52`
- `longitude`: `73.85`
- `notes`: `Cash fuel test`
- `photo`: file

Save `_id` as `cashReceiptId`.

### Admin Review Cash Receipt
Use `Authorization: Bearer {{adminToken}}`

`PUT {{baseUrl}}/api/fuel/cash-receipts/{{cashReceiptId}}/review`

```json
{
  "action": "APPROVE",
  "notes": "Valid receipt",
  "creditCashback": true
}
```

### Verify Driver Wallet
Use `Authorization: Bearer {{driverToken}}`

- `GET {{baseUrl}}/api/wallets/balance`
- `GET {{baseUrl}}/api/wallets/transactions`

## Admin Controls

Use `Authorization: Bearer {{adminToken}}`

- `GET {{baseUrl}}/api/admin/customers/duplicates`
- `POST {{baseUrl}}/api/admin/customers/merge`
- `GET {{baseUrl}}/api/admin/settings/milestone-rules`
- `PUT {{baseUrl}}/api/admin/settings/milestone-rules`
- `PUT {{baseUrl}}/api/admin/wallets/DRIVER/{{driverId}}/withdrawal`
- `GET {{baseUrl}}/api/admin/fraud/review-queue`
- `GET {{baseUrl}}/api/admin/settlements/oversight`
- `GET {{baseUrl}}/api/admin/audit-logs`

## Settlement Checks

Use `Authorization: Bearer {{adminToken}}`

### Calculate Settlement
`POST {{baseUrl}}/api/settlements/calculate`

```json
{
  "pumpOwnerId": "{{pumpOwnerId}}",
  "startDate": "2026-03-01",
  "endDate": "2026-03-31",
  "period": "March 2026",
  "createSettlement": true
}
```

Save returned settlement `_id` as `settlementId`.

### Process Settlement
`PUT {{baseUrl}}/api/settlements/{{settlementId}}/process`

### Complete Settlement
`PUT {{baseUrl}}/api/settlements/{{settlementId}}/complete`

```json
{
  "utr": "UTR123456789",
  "notes": "Settlement released"
}
```

## Socket.IO Testing In Postman

Postman can test this through a WebSocket request, but this server is Socket.IO, not plain WebSocket. You must send Socket.IO protocol frames manually.

### Connect URL

`ws://localhost:{{port}}/socket.io/?EIO=4&transport=websocket`

### Auth

In Postman WebSocket connect options, send auth token if supported. If not, use header:

- `Authorization: Bearer {{driverToken}}`

If Postman does not complete the Socket.IO handshake correctly, use a Socket.IO client instead. Postman is usable, but not ideal here.

### Initial Frames

After connect:

1. Wait for server handshake frame.
2. Send:

```text
40
```

### Join Rooms

Driver:

```text
42["join:driver","{{driverId}}"]
42["join:trip","{{customerTripId}}"]
```

Transporter:

```text
42["join:transporter","{{transporterId}}"]
42["join:trip","{{customerTripId}}"]
```

Customer:

```text
42["join:customer","{{customerId}}"]
42["join:trip","{{customerTripId}}"]
```

### Socket Test Events

Start trip:

```text
42["trip:start",{"tripId":"{{customerTripId}}"}]
```

Milestone update:

```text
42["trip:milestone:update",{"tripId":"{{customerTripId}}","milestoneNumber":1,"latitude":18.95,"longitude":72.95}]
```

Complete trip:

```text
42["trip:complete",{"tripId":"{{customerTripId}}"}]
```

### Expected Socket Events

- `trip:created`
- `trip:customer:accepted`
- `trip:customer:rejected`
- `trip:vehicle:assigned`
- `trip:driver:assigned`
- `trip:customer:assigned`
- `trip:started`
- `trip:milestone:updated`
- `trip:pod:uploaded`
- `trip:completed`
- `trip:pod:pending`
- `trip:closed:with-pod`
- `trip:closed:without-pod`
- `trip:auto-activated`

## Recommended Testing Order

1. Health and auth
2. Transporter creates driver and vehicle
3. Customer books trip
4. Transporter accepts and assigns
5. Driver starts and completes milestones
6. POD upload and approve
7. Visibility and share link checks
8. Wallet and Porttivo fuel flow
9. Cash receipt and cashback flow
10. Admin controls
11. Settlement flow
12. Socket flow

