# Vehicle Booking & Messaging System - Phase 1 API Documentation

## Overview
Complete booking system for transporter-to-transporter vehicle rental with integrated messaging and optional price negotiation.

---

## Base URL
```
http://localhost:3000/api
```

---

## Authentication
All endpoints require authentication with JWT token in header:
```
Authorization: Bearer <access_token>
```

---

## 1️⃣ VEHICLE BOOKING ENDPOINTS

### 1. Create Booking Request
**Endpoint:** `POST /vehicle-bookings`

**Description:** Create a booking request for a specific vehicle on a post

**Request Body:**
```json
{
  "postId": "post-id",
  "assignmentId": "assignment-id"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Booking request created successfully",
  "data": {
    "booking": {
      "id": "booking-id",
      "buyerId": {
        "id": "buyer-id",
        "name": "John Doe",
        "mobile": "9876543210",
        "company": "ABC Transport"
      },
      "sellerId": {
        "id": "seller-id",
        "name": "Jane Doe",
        "mobile": "9876543211",
        "company": "XYZ Transport"
      },
      "vehicleId": {
        "id": "vehicle-id",
        "vehicleNumber": "DL-01-AB-1234",
        "vehicleType": "Truck",
        "trailerType": "Flat-bed"
      },
      "status": "REQUESTED",
      "estimatedPrice": 5000,
      "agreedPrice": null,
      "negotiationRound": 0,
      "createdAt": "2024-01-15T10:00:00Z",
      "updatedAt": "2024-01-15T10:00:00Z"
    }
  }
}
```

**Error Responses:**
- `400` - postId/assignmentId missing or post not active
- `403` - Only transporters can create bookings
- `404` - Post or assignment not found

---

### 2. Get Single Booking
**Endpoint:** `GET /vehicle-bookings/:id`

**Description:** Get booking details with conversation history

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "booking": { ... },
    "messages": [
      {
        "id": "msg-id",
        "bookingId": "booking-id",
        "senderId": { "id": "sender-id", "name": "John" },
        "receiverId": { "id": "receiver-id", "name": "Jane" },
        "messageType": "TEXT",
        "content": "Hello, interested in this vehicle",
        "status": "READ",
        "createdAt": "2024-01-15T10:05:00Z"
      }
    ],
    "unreadCount": 0
  }
}
```

**Access Control:**
- Only buyer or seller can view (403 if third party)

---

### 3. Get My Bookings
**Endpoint:** `GET /vehicle-bookings/my-bookings`

**Query Parameters:**
- `role` (optional): `buyer` or `seller` (default: both)
- `status` (optional): `REQUESTED`, `NEGOTIATING`, `CONFIRMED`, `COMPLETED`, `CANCELLED`, `REJECTED`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Bookings retrieved successfully",
  "data": {
    "bookings": [
      {
        "id": "booking-id",
        "buyerId": { ... },
        "sellerId": { ... },
        "vehicleId": { ... },
        "status": "CONFIRMED",
        "estimatedPrice": 5000,
        "agreedPrice": 4800,
        "unreadMessageCount": 2,
        "createdAt": "2024-01-15T10:00:00Z"
      }
    ],
    "total": 1
  }
}
```

---

### 4. Propose Price Offer
**Endpoint:** `PUT /vehicle-bookings/:id/propose-price`

**Description:** Propose a price during negotiation (starts or continues negotiation)

**Request Body:**
```json
{
  "proposedPrice": 4800,
  "message": "Can you do 4800/km?"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Price proposal sent successfully",
  "data": {
    "booking": {
      "id": "booking-id",
      "status": "NEGOTIATING",
      "lastPriceProposal": {
        "proposedBy": "buyer-id",
        "proposedPrice": 4800,
        "proposedAt": "2024-01-15T10:10:00Z"
      },
      "negotiationRound": 1
    },
    "message": {
      "id": "msg-id",
      "messageType": "PRICE_PROPOSAL",
      "content": "Can you do 4800/km?",
      "proposedPrice": 4800,
      "status": "DELIVERED"
    }
  }
}
```

**Rules:**
- Either buyer or seller can propose price
- Updates booking status to NEGOTIATING
- Creates corresponding message record
- Increments negotiationRound counter

---

### 5. Accept Booking (Confirm)
**Endpoint:** `PUT /vehicle-bookings/:id/accept`

**Description:** Seller accepts booking and finalizes price

**Request Body:**
```json
{}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Booking confirmed successfully",
  "data": {
    "booking": {
      "id": "booking-id",
      "status": "CONFIRMED",
      "agreedPrice": 4800,
      "confirmedAt": "2024-01-15T10:15:00Z"
    }
  }
}
```

**Access Control:**
- Only seller can accept (403 otherwise)
- Only when status is REQUESTED or NEGOTIATING

**Logic:**
- If NEGOTIATING: uses last proposed price
- If REQUESTED: uses estimatedPrice
- Updates agreedPrice field
- Sets status to CONFIRMED
- Locks the booking (no more negotiation possible)

---

### 6. Reject Booking
**Endpoint:** `PUT /vehicle-bookings/:id/reject`

**Description:** Seller rejects booking

**Request Body:**
```json
{
  "reason": "Vehicle already booked"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Booking rejected successfully",
  "data": {
    "booking": {
      "id": "booking-id",
      "status": "REJECTED",
      "rejectedAt": "2024-01-15T10:20:00Z",
      "rejectReason": "Vehicle already booked"
    }
  }
}
```

**Access Control:**
- Only seller can reject (403 otherwise)
- Only when status is REQUESTED or NEGOTIATING

---

### 7. Cancel Booking
**Endpoint:** `DELETE /vehicle-bookings/:id`

**Description:** Buyer cancels booking before confirmation

**Request Body:**
```json
{
  "reason": "Found another vehicle"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Booking cancelled successfully",
  "data": {
    "booking": {
      "id": "booking-id",
      "status": "CANCELLED"
    }
  }
}
```

**Access Control:**
- Only buyer can cancel (403 otherwise)
- Only when status is REQUESTED or NEGOTIATING

---

### 8. Get Booking Stats
**Endpoint:** `GET /vehicle-bookings/stats`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "stats": {
      "totalAsNeeded": 10,
      "totalAsVendor": 25,
      "confirmedBookings": 8,
      "completedBookings": 5,
      "rejectedBookings": 2,
      "successRate": 80
    }
  }
}
```

---

## 2️⃣ MESSAGING ENDPOINTS

### 1. Send Message
**Endpoint:** `POST /messages`

**Description:** Send a message in booking conversation

**Request Body:**
```json
{
  "bookingId": "booking-id",
  "content": "What's your best price?",
  "messageType": "TEXT"
}
```

**messageType Values:**
- `TEXT` - Regular text message
- `PRICE_PROPOSAL` - Price offer message
- `PRICE_COUNTER` - Counter-offer to price

**Response (201 Created):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "message": {
      "id": "msg-id",
      "bookingId": "booking-id",
      "senderId": {
        "id": "sender-id",
        "name": "John Doe",
        "company": "ABC Transport"
      },
      "receiverId": {
        "id": "receiver-id",
        "name": "Jane Doe"
      },
      "messageType": "TEXT",
      "content": "What's your best price?",
      "status": "DELIVERED",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

**Access Control:**
- User must be buyer or seller in the booking
- Third party (Transporter C) gets 403

---

### 2. Get Conversation
**Endpoint:** `GET /messages/booking/:bookingId`

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50)

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg-1",
        "bookingId": "booking-id",
        "senderId": {
          "id": "buyer-id",
          "name": "John Doe",
          "mobile": "9876543210",
          "company": "ABC Transport"
        },
        "receiverId": {
          "id": "seller-id",
          "name": "Jane Doe"
        },
        "messageType": "TEXT",
        "content": "Interested in the truck",
        "status": "READ",
        "readAt": "2024-01-15T10:35:00Z",
        "createdAt": "2024-01-15T10:30:00Z"
      },
      {
        "id": "msg-2",
        "bookingId": "booking-id",
        "senderId": {
          "id": "seller-id",
          "name": "Jane Doe",
          "mobile": "9876543211"
        },
        "messageType": "TEXT",
        "content": "Great! Price is 5000/km",
        "status": "READ",
        "readAt": "2024-01-15T10:36:00Z",
        "createdAt": "2024-01-15T10:33:00Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 50,
      "total": 2,
      "pages": 1
    },
    "unreadCount": 0,
    "otherParty": {
      "id": "seller-id"
    }
  }
}
```

**Privacy:**
- Only buyer or seller can view (403 otherwise)
- All unread messages auto-marked as READ on retrieval
- Transporter C trying to access → 403 Forbidden

---

### 3. Mark Message as Read
**Endpoint:** `PUT /messages/:messageId/read`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Message marked as read",
  "data": {
    "message": {
      "id": "msg-id",
      "status": "READ",
      "readAt": "2024-01-15T10:40:00Z"
    }
  }
}
```

---

### 4. Get Unread Count
**Endpoint:** `GET /messages/unread-count`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "totalUnread": 3,
    "byBooking": [
      {
        "bookingId": "booking-1",
        "unreadCount": 2
      },
      {
        "bookingId": "booking-2",
        "unreadCount": 1
      }
    ]
  }
}
```

---

### 5. Search Messages
**Endpoint:** `GET /messages/search/:bookingId`

**Query Parameters:**
- `query` (optional): Search text
- `messageType` (optional): Filter by message type

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "messages": [ ... ],
    "total": 5
  }
}
```

---

### 6. Delete Message
**Endpoint:** `DELETE /messages/:messageId`

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Message deleted successfully"
}
```

**Constraints:**
- Only sender can delete (403 otherwise)
- Only within 5 minutes of sending
- Message content replaced with "[Message deleted]"

---

## 🔌 SOCKET.IO EVENTS

### Server Emits (Real-time Updates)

#### booking:requested
Emitted when buyer requests to book a vehicle
```javascript
socket.on('booking:requested', (data) => {
  // data: { booking: {...}, buyer: {...}, vehicle: {...} }
});
```
**Sent to:** `transporter:{sellerId}`

---

#### booking:price-proposed
Emitted when either party proposes a price
```javascript
socket.on('booking:price-proposed', (data) => {
  // data: { booking: {...}, message: {...} }
});
```
**Sent to:** `transporter:{recipientId}`

---

#### booking:confirmed
Emitted when booking is confirmed
```javascript
socket.on('booking:confirmed', (data) => {
  // data: { booking: {...} }
});
```
**Sent to:** Both `transporter:{buyerId}` and `transporter:{sellerId}`

---

#### booking:rejected
Emitted when booking is rejected by seller
```javascript
socket.on('booking:rejected', (data) => {
  // data: { booking: {...} }
});
```
**Sent to:** `transporter:{buyerId}`

---

#### booking:cancelled
Emitted when booking is cancelled by buyer
```javascript
socket.on('booking:cancelled', (data) => {
  // data: { booking: {...} }
});
```
**Sent to:** `transporter:{sellerId}`

---

#### message:new
Emitted when new message received
```javascript
socket.on('message:new', (data) => {
  // data: { bookingId, message: {...} }
});
```
**Sent to:** `transporter:{receiverId}`

---

#### message:read
Emitted when message is read by recipient
```javascript
socket.on('message:read', (data) => {
  // data: { messageId, readAt }
});
```
**Sent to:** `transporter:{senderId}`

---

## 🔄 COMPLETE WORKFLOW EXAMPLE

### Scenario: Transporter B books Transporter A's vehicle

**Step 1: B requests to book**
```bash
POST /api/vehicle-bookings
{
  "postId": "post-123",
  "assignmentId": "assignment-456"
}
```
→ Booking created with status REQUESTED
→ A receives `booking:requested` event

**Step 2: A & B negotiate price (Optional)**
```bash
PUT /api/vehicle-bookings/booking-id/propose-price
{
  "proposedPrice": 4800,
  "message": "Can you do 4800?"
}
```
→ Status becomes NEGOTIATING
→ B receives `booking:price-proposed` event
→ Message sent to B

**Step 3: B sends message**
```bash
POST /api/messages
{
  "bookingId": "booking-id",
  "content": "That works for me!"
}
```
→ A receives `message:new` event

**Step 4: A accepts booking**
```bash
PUT /api/vehicle-bookings/booking-id/accept
```
→ Status becomes CONFIRMED
→ agreedPrice = 4800
→ Both A & B receive `booking:confirmed` event

**Step 5: Booking ready for trip execution**
- Confirmed booking with locked price
- Vehicle assigned to Transporter B
- Ready for Phase 2 integration (trip creation)

---

## 🔐 Privacy & Security Rules

| Rule | Enforcement |
|------|------------|
| Only buyer or seller can view booking | Middleware validates participant status |
| Transporter C cannot see A-B chat | 403 Forbidden if user not in booking |
| Only receiver can mark message read | `receiverId` check in controller |
| Only sender can delete message | `senderId` check in controller |
| Message sender privacy | No message history without access |
| No booking visibility to third party | Booking details hidden from non-participants |

---

## 📊 Database Audit Trail

All booking actions are logged in `VehicleBookingAudit`:
- Action type (CREATED, PRICE_PROPOSED, CONFIRMED, etc.)
- Who performed it (performedBy)
- Timestamp
- Details (old/new values)

---

## ✅ Validation Rules

| Field | Rule |
|-------|------|
| postId | Must exist and be active |
| assignmentId | Must belong to the post |
| proposedPrice | Must be > 0 |
| buyerId ≠ sellerId | Cannot book own vehicle |
| Status transitions | Must follow valid state machine |

---

## 🚀 Phase 1 Complete ✅

Next: Phase 2 - Trip Integration, Notifications, Analytics

