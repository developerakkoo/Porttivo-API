# Vehicle Booking Workflow - Complete Guide

## Overview
This document describes the complete workflow for booking vehicles between transporters. The workflow enables vehicle owners to post available vehicles and prices, allows other transporters to search and negotiate, facilitates communication, and ultimately enables vehicle booking and trip initiation.

---

## Workflow Steps

### Step 1: Post Vehicle Availability
**Actor:** Vehicle Owner/Transporter  
**Endpoint:** `POST /api/vehicle-posts`

A transporter posts vehicle availability for rent/lease.

**Request Body:**
```json
{
  "vehicleId": "vehicle_id_optional",
  "vehicleType": "TANKER",
  "origin": "Mumbai",
  "destination": "Delhi",
  "availableFrom": "2024-05-01T00:00:00Z",
  "availableTo": "2024-05-15T23:59:59Z",
  "quantity": 1,
  "pricePerVehicle": 50000,
  "note": "Well-maintained tanker, AC cabin"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Vehicle availability posted",
  "data": {
    "post": {
      "id": "post_id",
      "transporter": {
        "id": "transporter_id",
        "name": "ABC Transport",
        "company": "ABC Logistics",
        "mobile": "9999999999",
        "status": "active"
      },
      "vehicle": {
        "id": "vehicle_id",
        "vehicleNumber": "MH01AB1234",
        "vehicleType": "TANKER",
        "trailerType": "Single Axle"
      },
      "vehicleType": "TANKER",
      "origin": "Mumbai",
      "destination": "Delhi",
      "quantity": 1,
      "slotsLeft": 1,
      "pricePerVehicle": 50000,
      "availableFrom": "2024-05-01T00:00:00Z",
      "availableTo": "2024-05-15T23:59:59Z",
      "note": "Well-maintained tanker, AC cabin",
      "status": "active",
      "createdAt": "2024-04-24T10:00:00Z",
      "updatedAt": "2024-04-24T10:00:00Z"
    }
  }
}
```

**Important Notes:**
- Only authenticated transporters can post vehicles
- Vehicle must belong to the transporter (if vehicleId provided)
- Either `availableTo` or `durationDays` must be provided
- Post status is automatically set to "active"

---

### Step 2: Search Vehicle Posts
**Actor:** Transporter seeking vehicles  
**Endpoint:** `GET /api/vehicle-posts?origin=&destination=&vehicleType=&date=&page=&limit=`

Search for available vehicle posts using filters.

**Query Parameters:**
- `origin` (optional): Filter by origin location
- `destination` (optional): Filter by destination
- `vehicleType` (optional): Filter by vehicle type (e.g., "TANKER", "TRUCK")
- `date` (optional): Filter by availability date (ISO format)
- `page` (default: 1): Pagination page
- `limit` (default: 20): Results per page

**Response:**
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "id": "post_id",
        "transporter": {
          "id": "transporter_id",
          "name": "ABC Transport",
          "company": "ABC Logistics",
          "mobile": "9999999999"
        },
        "vehicleType": "TANKER",
        "origin": "Mumbai",
        "destination": "Delhi",
        "quantity": 2,
        "slotsLeft": 1,
        "pricePerVehicle": 50000,
        "availableFrom": "2024-05-01T00:00:00Z",
        "availableTo": "2024-05-15T23:59:59Z",
        "status": "active"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 5,
      "totalResults": 97
    }
  }
}
```

**Features:**
- Real-time search with flexible filtering
- Socket event emitted when new posts are created
- Only active posts are shown
- Date matching considers availability range intersection

---

### Step 3: View Post Details
**Actor:** Transporter interested in a post  
**Endpoint:** `GET /api/vehicle-posts/:id`

Get detailed information about a specific post.

**Response:**
```json
{
  "success": true,
  "data": {
    "post": {
      "id": "post_id",
      "transporter": {
        "id": "transporter_id",
        "name": "ABC Transport",
        "company": "ABC Logistics",
        "mobile": "9999999999",
        "rating": 4.5
      },
      "vehicle": {
        "id": "vehicle_id",
        "vehicleNumber": "MH01AB1234",
        "vehicleType": "TANKER",
        "trailerType": "Single Axle",
        "owner": "ABC Transport"
      },
      "vehicleType": "TANKER",
      "origin": "Mumbai",
      "destination": "Delhi",
      "quantity": 2,
      "slotsLeft": 1,
      "pricePerVehicle": 50000,
      "availableFrom": "2024-05-01T00:00:00Z",
      "availableTo": "2024-05-15T23:59:59Z",
      "note": "Well-maintained tanker, AC cabin",
      "status": "active",
      "createdAt": "2024-04-24T10:00:00Z"
    }
  }
}
```

---

### Step 4: Initiate Chat & Negotiate
**Actor:** Both transporter parties  
**Endpoint:** `POST /api/vehicle-bookings` then `POST /api/messages`

First, create a booking request, then communicate via messages.

#### 4a. Create Booking Request
**Endpoint:** `POST /api/vehicle-bookings`

**Request Body:**
```json
{
  "postId": "post_id",
  "assignmentId": "vehicle_assignment_id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking requested",
  "data": {
    "booking": {
      "id": "booking_id",
      "postId": "post_id",
      "buyerId": "buyer_transporter_id",
      "sellerId": "seller_transporter_id",
      "vehicleId": "vehicle_id",
      "estimatedPrice": 50000,
      "status": "REQUESTED",
      "negotiationRound": 0,
      "createdAt": "2024-04-24T10:15:00Z"
    }
  }
}
```

**Status Flow:** 
- `REQUESTED` → `NEGOTIATING` → `CONFIRMED` → `COMPLETED` (or `CANCELLED`/`REJECTED`)

---

#### 4b. Send Messages
**Endpoint:** `POST /api/messages`

Send text or price proposal messages in the booking conversation.

**Text Message:**
```json
{
  "bookingId": "booking_id",
  "content": "Can you provide more details about the vehicle condition?",
  "messageType": "TEXT"
}
```

**Price Proposal Message:**
```json
{
  "bookingId": "booking_id",
  "content": "I can offer 48000 for this vehicle",
  "messageType": "PRICE_PROPOSAL",
  "proposedPrice": 48000
}
```

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "message": {
      "id": "message_id",
      "bookingId": "booking_id",
      "senderId": "sender_id",
      "senderName": "XYZ Logistics",
      "receiverId": "receiver_id",
      "content": "I can offer 48000 for this vehicle",
      "messageType": "PRICE_PROPOSAL",
      "proposedPrice": 48000,
      "status": "DELIVERED",
      "createdAt": "2024-04-24T10:20:00Z"
    }
  }
}
```

**Message Types:**
- `TEXT`: Regular message
- `PRICE_PROPOSAL`: Initial price offer
- `PRICE_COUNTER`: Counter offer during negotiation
- `ACCEPTED`: Acceptance of terms
- `REJECTED`: Rejection of terms

---

#### 4c. Retrieve Conversation
**Endpoint:** `GET /api/messages/booking/:bookingId?page=1&limit=50`

Get all messages in a booking conversation.

**Response:**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg1",
        "senderId": "buyer_id",
        "senderName": "Buyer Transport",
        "content": "Can you provide more details?",
        "messageType": "TEXT",
        "status": "READ",
        "createdAt": "2024-04-24T10:20:00Z"
      },
      {
        "id": "msg2",
        "senderId": "seller_id",
        "senderName": "ABC Transport",
        "content": "I can offer 48000",
        "messageType": "PRICE_PROPOSAL",
        "proposedPrice": 48000,
        "status": "DELIVERED",
        "createdAt": "2024-04-24T10:22:00Z"
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalResults": 2
    }
  }
}
```

---

### Step 5: Price Negotiation
**Actor:** Both booking parties  
**Endpoint:** `PUT /api/vehicle-bookings/:id/propose-price`

Propose or counter-propose prices during negotiation.

**Request Body:**
```json
{
  "proposedPrice": 49000,
  "message": "This is my best offer"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Price proposal submitted",
  "data": {
    "booking": {
      "id": "booking_id",
      "status": "NEGOTIATING",
      "estimatedPrice": 50000,
      "lastPriceProposal": {
        "proposedBy": "buyer_transporter_id",
        "proposedPrice": 49000,
        "proposedAt": "2024-04-24T10:25:00Z"
      },
      "negotiationRound": 1,
      "updatedAt": "2024-04-24T10:25:00Z"
    }
  }
}
```

**Negotiation Flow:**
1. Buyer sends initial booking (REQUESTED)
2. Both parties send messages with `PRICE_PROPOSAL` type
3. Booking status changes to `NEGOTIATING`
4. Tracks negotiation rounds and last price proposal
5. Either party can accept or reject the terms

---

### Step 6: Accept Booking
**Actor:** Seller (vehicle owner)  
**Endpoint:** `PUT /api/vehicle-bookings/:id/accept`

Accept the booking request after negotiation (or immediately if no negotiation).

**Request Body:**
```json
{
  "agreedPrice": 49000,
  "message": "Accepted. Let's proceed with 49000"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking confirmed",
  "data": {
    "booking": {
      "id": "booking_id",
      "status": "CONFIRMED",
      "estimatedPrice": 50000,
      "agreedPrice": 49000,
      "confirmedAt": "2024-04-24T10:30:00Z",
      "tripId": null
    }
  }
}
```

**Important:**
- Only seller can accept a booking
- Moves booking from `REQUESTED` or `NEGOTIATING` to `CONFIRMED`
- Socket event emitted to both parties
- Notification sent to buyer

---

### Step 7: Reject/Cancel Booking
**Actor:** Seller (reject) or Buyer (cancel)  
**Endpoints:** 
- `PUT /api/vehicle-bookings/:id/reject` (seller)
- `DELETE /api/vehicle-bookings/:id` (buyer)

**Request Body (Reject):**
```json
{
  "reason": "Vehicle already booked by another party"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Booking rejected",
  "data": {
    "booking": {
      "id": "booking_id",
      "status": "REJECTED",
      "rejectedAt": "2024-04-24T10:35:00Z",
      "rejectReason": "Vehicle already booked by another party"
    }
  }
}
```

---

### Step 8: Create Trip from Booking
**Actor:** Seller (vehicle owner)  
**Endpoint:** `POST /api/trips`

After booking is confirmed, create a trip linked to the booking.

**Request Body:**
```json
{
  "vehicleId": "vehicle_id",
  "driverId": "driver_id",
  "origin": "Mumbai",
  "destination": "Delhi",
  "loadType": "Fuel",
  "quantity": 25000,
  "unit": "Liters",
  "pickupLocation": {
    "name": "XYZ Fuel Station",
    "address": "Mumbai"
  },
  "dropLocation": {
    "name": "ABC Fuel Station",
    "address": "Delhi"
  },
  "bookingId": "booking_id"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Trip created",
  "data": {
    "trip": {
      "id": "trip_id",
      "vehicleId": "vehicle_id",
      "driverId": "driver_id",
      "vehicleNumber": "MH01AB1234",
      "origin": "Mumbai",
      "destination": "Delhi",
      "status": "CREATED",
      "bookingId": "booking_id",
      "createdAt": "2024-04-24T10:40:00Z"
    }
  }
}
```

**Link to Booking:**
- Trip creation can reference `bookingId`
- VehicleBooking model has `tripId` field for reverse reference
- Enables tracking of vehicle bookings to actual trips

---

### Step 9: Start Trip
**Actor:** Driver or Transporter  
**Endpoint:** `PUT /api/trips/:id/start`

Initialize the trip to mark it as in-progress.

**Request Body:**
```json
{
  "startLocation": {
    "latitude": 19.0760,
    "longitude": 72.8777
  },
  "estimatedEndTime": "2024-04-26T18:00:00Z"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Trip started",
  "data": {
    "trip": {
      "id": "trip_id",
      "status": "IN_PROGRESS",
      "startedAt": "2024-04-24T10:45:00Z",
      "startLocation": {
        "latitude": 19.0760,
        "longitude": 72.8777
      },
      "estimatedEndTime": "2024-04-26T18:00:00Z"
    }
  }
}
```

**Status Progression:**
- `CREATED` → `IN_PROGRESS` → `COMPLETED` (or `CANCELLED`)

---

## Key Features

### 1. Real-Time Communication
- WebSocket events for:
  - New vehicle posts: `vehiclePost:created`
  - Booking requests: `booking:requested`
  - New messages: `message:new`
  - Booking status changes: `booking:accepted`, `booking:rejected`
  - Trip updates: `trip:started`, `trip:completed`

### 2. Price Negotiation Tracking
- Stores negotiation history per booking
- Tracks number of negotiation rounds
- Records last price proposal with proposer info
- Audit trail of all proposals

### 3. Message Types
- **TEXT**: Regular communication
- **PRICE_PROPOSAL**: Initial offer
- **PRICE_COUNTER**: Counter-offer
- **ACCEPTED**: Terms accepted
- **REJECTED**: Terms rejected
- **SYSTEM**: Automated notifications

### 4. Booking States
```
REQUESTED → NEGOTIATING → CONFIRMED → COMPLETED
         ↓                  ↓
       REJECTED          CANCELLED
```

### 5. Security & Permissions
- Only authenticated transporters can participate
- Seller must approve bookings
- Buyer can only cancel before confirmation
- Message access restricted to booking participants
- Vehicle ownership validation

### 6. Notifications
- Booking request received
- New messages
- Booking accepted/rejected
- Negotiation round updates
- Trip creation confirmation
- Trip start notifications

---

## Database Models

### VehicleRouteAvailability
```javascript
{
  transporterId,        // Vehicle owner
  vehicleId,           // Optional - specific vehicle
  vehicleType,         // TANKER, TRUCK, etc.
  origin,              // Starting location
  destination,         // End location
  quantity,            // Number of slots
  slotsLeft,           // Available slots
  pricePerVehicle,     // Asking price
  availableFrom,       // Start date
  availableTo,         // End date
  note,                // Description
  status,              // active, cancelled
  createdAt,
  updatedAt
}
```

### VehicleBooking
```javascript
{
  postId,              // Reference to VehicleRouteAvailability
  assignmentId,        // Vehicle assignment
  vehicleId,           // The vehicle being booked
  buyerId,             // Transporter booking
  sellerId,            // Vehicle owner
  status,              // REQUESTED, NEGOTIATING, CONFIRMED, etc.
  estimatedPrice,      // Initial price
  agreedPrice,         // Final negotiated price
  negotiationRound,    // Number of rounds
  lastPriceProposal,   // Latest proposal details
  tripId,              // Linked trip after booking
  paymentStatus,       // PENDING, HOLD, COMPLETED, REFUNDED
  createdAt,
  updatedAt
}
```

### TransporterMessage
```javascript
{
  bookingId,           // Which booking this is for
  senderId,            // Who sent it
  receiverId,          // Who receives it
  messageType,         // TEXT, PRICE_PROPOSAL, etc.
  content,             // Message body
  proposedPrice,       // Price if type is PRICE_PROPOSAL
  status,              // SENT, DELIVERED, READ
  createdAt,
  updatedAt
}
```

---

## API Endpoints Summary

| Method | Endpoint | Purpose | Actor |
|--------|----------|---------|-------|
| POST | `/api/vehicle-posts` | Post vehicle availability | Vehicle Owner |
| GET | `/api/vehicle-posts` | Search posts | Transporter |
| GET | `/api/vehicle-posts/:id` | View post details | Transporter |
| PUT | `/api/vehicle-posts/:id` | Update post | Vehicle Owner |
| DELETE | `/api/vehicle-posts/:id` | Cancel post | Vehicle Owner |
| POST | `/api/vehicle-bookings` | Create booking request | Transporter |
| GET | `/api/vehicle-bookings/:id` | View booking | Both parties |
| GET | `/api/vehicle-bookings/my-bookings` | List my bookings | Transporter |
| PUT | `/api/vehicle-bookings/:id/propose-price` | Propose price | Both parties |
| PUT | `/api/vehicle-bookings/:id/accept` | Accept booking | Seller |
| PUT | `/api/vehicle-bookings/:id/reject` | Reject booking | Seller |
| DELETE | `/api/vehicle-bookings/:id` | Cancel booking | Buyer |
| POST | `/api/messages` | Send message | Both parties |
| GET | `/api/messages/booking/:bookingId` | Get conversation | Both parties |
| POST | `/api/trips` | Create trip | Transporter |
| PUT | `/api/trips/:id/start` | Start trip | Driver/Transporter |
| PUT | `/api/trips/:id/complete` | Complete trip | Driver/Transporter |

---

## Error Handling

### Common Error Codes

| Status | Message | Solution |
|--------|---------|----------|
| 400 | Post not found or inactive | Verify post ID and status |
| 400 | You cannot book your own vehicle | Different transporter must book |
| 400 | You already have an active booking | Cancel previous booking first |
| 403 | You do not have access to this booking | Not a party to the booking |
| 404 | Vehicle not found | Verify vehicle ID |
| 404 | Vehicle assignment not found | Verify assignment ID |

---

## Best Practices

1. **Before Booking:**
   - Search thoroughly for available posts
   - Review transporter ratings and reviews
   - Check vehicle details and condition

2. **During Negotiation:**
   - Be clear about terms in messages
   - Propose realistic prices
   - Provide context for counter-offers

3. **After Confirmation:**
   - Ensure payment is processed before trip start
   - Confirm vehicle condition with photos
   - Establish clear communication channels

4. **Trip Management:**
   - Provide accurate pickup/drop locations
   - Update trip status regularly
   - Document any issues with photos/POD

---

## Future Enhancements

- [ ] Ratings & Reviews system
- [ ] Dispute resolution mechanism
- [ ] Payment integration
- [ ] Insurance coverage tracking
- [ ] Document verification
- [ ] Route optimization
- [ ] Real-time vehicle tracking
- [ ] Fuel consumption analytics
