# WATI Template Integration

## Overview

This project integrates WATI WhatsApp template messaging for customer trip booking and trip lifecycle updates.

The WATI integration is implemented so that WhatsApp delivery failures do not fail the main API request. If WATI returns an error, the API can still return success for the trip action, and the failure is logged in the server terminal.

Primary implementation files:

- `src/services/wati.service.js`
- `src/controllers/trip.controller.js`
- `src/controllers/tripMilestone.controller.js`
- `src/controllers/tripStatus.controller.js`
- `src/routes/trip.routes.js`

## Configuration

The integration uses these config values:

- `WATI_API_ENDPOINT`
- `WATI_BEARER_TOKEN`
- `WATI_DEFAULT_COUNTRY_CODE`
- `WATI_BROADCAST_PREFIX`

Example:

```env
WATI_API_ENDPOINT=https://live-mt-server.wati.io/10105134
WATI_BEARER_TOKEN=Bearer your_token_here
WATI_DEFAULT_COUNTRY_CODE=91
WATI_BROADCAST_PREFIX=porttivo
```

Notes:

- Restart the server after changing WATI config.
- If the token already starts with `Bearer `, the service uses it as-is.
- Mobile numbers stored as 10 digits are converted to WhatsApp format using `WATI_DEFAULT_COUNTRY_CODE`.

## Implemented Templates

### 1. `porttivo_trip_created_confirmation`

Trigger:
- Customer creates a trip

Endpoint:
- `POST /api/trips/customer/book`

Recipient:
- Customer

Parameters:
- `{{1}}` Customer name
- `{{2}}` Pickup location
- `{{3}}` Drop location

### 2. `booking_request_received`

Trigger:
- Customer creates a trip

Endpoint:
- `POST /api/trips/customer/book`

Recipient:
- All active transporters with `hasAccess: true`

Parameters:
- `{{1}}` Pickup location
- `{{2}}` Loading / Unloading from `trip.loadType`
- `{{3}}` Return location from `trip.dropLocation`
- `{{4}}` Date from `trip.scheduledAt`

### 3. `booking_accepted`

Trigger:
- Transporter accepts a customer booking

Endpoint:
- `PUT /api/trips/:id/accept`

Recipient:
- Customer

Parameters:
- `{{1}}` Pickup location
- `{{2}}` Loading / Unloading from `trip.loadType`
- `{{3}}` Return location from `trip.dropLocation`
- `{{4}}` Date from `trip.scheduledAt`

### 4. `booking_rejected`

Trigger:
- Transporter rejects a customer booking

Endpoint:
- `PUT /api/trips/:id/reject`

Recipient:
- Customer

Parameters:
- `{{1}}` Pickup location
- `{{2}}` Loading / Unloading from `trip.loadType`
- `{{3}}` Date from `trip.scheduledAt`

### 5. `driver_vehicle_assigned`

Trigger:
- Transporter assigns vehicle and driver

Endpoint:
- `PUT /api/trips/:id/assign`

Recipient:
- Customer

Parameters:
- `{{1}}` Customer name
- `{{2}}` Pickup location
- `{{3}}` Loading / Unloading from `trip.loadType`
- `{{4}}` Date from `trip.scheduledAt`
- `{{5}}` Driver mobile number
- `{{6}}` Vehicle number

### 6. `container_picked`

Trigger:
- Milestone 1 completed

Endpoint:
- `POST /api/trips/:id/milestones/1`

Recipient:
- Customer

Parameters:
- `{{1}}` Vehicle number
- `{{2}}` Driver mobile number

### 7. `vehicle_reached_pickup`

Trigger:
- Milestone 2 completed

Endpoint:
- `POST /api/trips/:id/milestones/2`

Recipient:
- Customer

Parameters:
- `{{1}}` Vehicle number
- `{{2}}` Driver mobile number

### 8. `trip_completed`

Trigger:
- Trip completed successfully

Endpoint:
- `PUT /api/trips/:id/complete`

Recipients:
- Customer
- Transporter

Parameters:
- `{{1}}` Vehicle number
- `{{2}}` Driver mobile number

## API Flow Mapping

### Customer Booking Flow

1. Customer calls `POST /api/trips/customer/book`
2. Customer receives `porttivo_trip_created_confirmation`
3. Active transporters receive `booking_request_received`

### Booking Decision Flow

If transporter accepts:

1. Transporter calls `PUT /api/trips/:id/accept`
2. Customer receives `booking_accepted`

If transporter rejects:

1. Transporter calls `PUT /api/trips/:id/reject`
2. Customer receives `booking_rejected`

### Assignment Flow

1. Transporter calls `PUT /api/trips/:id/assign`
2. Customer receives `driver_vehicle_assigned`

### Milestone Flow

1. Assigned driver starts trip or transporter starts it using `PUT /api/trips/:id/start`
2. Assigned driver updates milestones in order:
   - `POST /api/trips/:id/milestones/1`
   - `POST /api/trips/:id/milestones/2`
   - `POST /api/trips/:id/milestones/3`
   - `POST /api/trips/:id/milestones/4`
   - `POST /api/trips/:id/milestones/5`

WATI milestone templates:

- Milestone 1 sends `container_picked`
- Milestone 2 sends `vehicle_reached_pickup`

### Completion Flow

1. After all 5 milestones are completed, transporter or assigned driver calls `PUT /api/trips/:id/complete`
2. Customer receives `trip_completed`
3. Transporter receives `trip_completed`

## Postman Testing Guide

Recommended end-to-end order:

1. Customer books trip
2. Transporter accepts or rejects
3. If accepted, transporter assigns vehicle and driver
4. Transporter or driver starts trip
5. Assigned driver completes milestones in sequence
6. Transporter or driver completes trip

Auth requirements:

- `POST /api/trips/customer/book`: customer token
- `PUT /api/trips/:id/accept`: transporter token
- `PUT /api/trips/:id/reject`: transporter token
- `PUT /api/trips/:id/assign`: transporter token
- `PUT /api/trips/:id/start`: transporter token or assigned driver token
- `POST /api/trips/:id/milestones/:milestoneNumber`: assigned driver token only
- `PUT /api/trips/:id/complete`: transporter token or assigned driver token

Important:

- Milestone APIs do not work with transporter auth unless the route explicitly allows it. In the current code, milestone update is driver-only.
- Milestones must be completed in sequence.

## Logging and Troubleshooting

Successful send example:

```text
WATI template sent successfully: booking_accepted -> 919403884093
```

Failure example:

```text
WATI booking accepted template failed: WATI request failed with status 400: ...
```

Skip examples:

```text
WATI send skipped: configuration is missing
WATI send skipped: WhatsApp number is missing
```

Common issues:

- Wrong `WATI_API_ENDPOINT`
- Invalid `WATI_BEARER_TOKEN`
- Template name not matching WATI approved template
- Template not approved in WATI
- Customer or transporter mobile number missing or invalid
- No transporter matches `status: active` and `hasAccess: true`
- Milestone API tested with transporter token instead of assigned driver token
- Trip not assigned or not started before milestone update

## Template Field Assumptions

These mappings are currently used in code:

- `Loading / Unloading` -> `trip.loadType`
- `Return Location` -> `trip.dropLocation`
- `Date` -> `trip.scheduledAt`
- `Driver No` -> `trip.driverId.mobile`
- `Vehicle No` -> `trip.vehicleId.vehicleNumber`

## Notes

- Booking rejection is implemented as a per-transporter rejection. A transporter who rejects a booking will not see that booking again in available customer trips.
- WATI sends are handled in the background of the API flow and do not block the main business action.
