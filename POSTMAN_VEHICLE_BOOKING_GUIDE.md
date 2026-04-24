# Vehicle Booking Workflow - Postman Testing Guide

## Quick Start

This guide provides Postman requests for the complete vehicle booking workflow.

### Prerequisites
1. Import the API collection into Postman
2. Set up environment variables:
   - `base_url`: http://localhost:3000/api
   - `token_owner`: Token for vehicle owner/seller
   - `token_transporter`: Token for transporter/buyer
   - `vehicle_id`: ID of available vehicle
   - `vehicle_type_id`: ID of vehicle type

---

## Complete Workflow Test Sequence

### Setup: Get Authentication Tokens

#### 1. Login as Vehicle Owner
```
POST {{base_url}}/auth/login
Content-Type: application/json

{
  "mobile": "9999999999",
  "password": "password123",
  "userType": "transporter"
}

Response: Save token to {{token_owner}}
```

#### 2. Login as Transporter/Buyer
```
POST {{base_url}}/auth/login
Content-Type: application/json

{
  "mobile": "8888888888",
  "password": "password123",
  "userType": "transporter"
}

Response: Save token to {{token_transporter}}
```

---

### Step 1: Post Vehicle Availability

**Endpoint:** `POST {{base_url}}/vehicle-posts`  
**Auth:** Bearer {{token_owner}}

```json
{
  "vehicleId": "{{vehicle_id}}",
  "vehicleType": "TANKER",
  "origin": "Mumbai",
  "destination": "Delhi",
  "availableFrom": "2024-05-01T00:00:00Z",
  "availableTo": "2024-05-15T23:59:59Z",
  "quantity": 2,
  "pricePerVehicle": 50000,
  "note": "Well-maintained tanker, AC cabin, recent service"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Vehicle availability posted",
  "data": {
    "post": {
      "id": "post_123456",
      "transporter": {
        "id": "owner_123",
        "name": "ABC Transport",
        "mobile": "9999999999"
      },
      "vehicleType": "TANKER",
      "origin": "Mumbai",
      "destination": "Delhi",
      "quantity": 2,
      "slotsLeft": 2,
      "pricePerVehicle": 50000,
      "status": "active"
    }
  }
}
```

**Save Response:**
- `post_id` from response → `{{post_id}}`

---

### Step 2: Search Vehicle Posts

**Endpoint:** `GET {{base_url}}/vehicle-posts?origin=Mumbai&destination=Delhi&vehicleType=TANKER&page=1&limit=20`  
**Auth:** Bearer {{token_transporter}}

**Expected Response:**
```json
{
  "success": true,
  "data": {
    "posts": [
      {
        "id": "post_123456",
        "transporter": {
          "id": "owner_123",
          "name": "ABC Transport"
        },
        "vehicleType": "TANKER",
        "origin": "Mumbai",
        "destination": "Delhi",
        "slotsLeft": 2,
        "pricePerVehicle": 50000
      }
    ],
    "pagination": {
      "currentPage": 1,
      "totalPages": 1,
      "totalResults": 1
    }
  }
}
```

---

### Step 3: View Post Details

**Endpoint:** `GET {{base_url}}/vehicle-posts/{{post_id}}`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "success": true,
  "data": {
    "post": {
      "id": "post_123456",
      "transporter": {
        "id": "owner_123",
        "name": "ABC Transport",
        "company": "ABC Logistics",
        "mobile": "9999999999",
        "rating": 4.5
      },
      "vehicle": {
        "id": "vehicle_id_1",
        "vehicleNumber": "MH01AB1234",
        "vehicleType": "TANKER"
      },
      "origin": "Mumbai",
      "destination": "Delhi",
      "pricePerVehicle": 50000,
      "availableFrom": "2024-05-01T00:00:00Z",
      "availableTo": "2024-05-15T23:59:59Z"
    }
  }
}
```

---

### Step 4: Create Booking Request

**Endpoint:** `POST {{base_url}}/vehicle-bookings`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "postId": "{{post_id}}",
  "assignmentId": "assignment_123"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Booking request created successfully",
  "data": {
    "booking": {
      "id": "booking_123456",
      "postId": "post_123456",
      "buyerId": "transporter_456",
      "sellerId": "owner_123",
      "vehicleId": "vehicle_id_1",
      "estimatedPrice": 50000,
      "status": "REQUESTED",
      "negotiationRound": 0,
      "createdAt": "2024-04-24T10:15:00Z"
    }
  }
}
```

**Save Response:**
- `booking.id` → `{{booking_id}}`

---

### Step 5: Send Chat Messages

#### 5a. Transporter Sends Initial Message
**Endpoint:** `POST {{base_url}}/messages`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "bookingId": "{{booking_id}}",
  "content": "Hi! Can you provide more details about the vehicle condition and maintenance history?",
  "messageType": "TEXT"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "message": {
      "id": "msg_001",
      "bookingId": "booking_123456",
      "senderId": "transporter_456",
      "senderName": "XYZ Logistics",
      "content": "Hi! Can you provide more details...",
      "messageType": "TEXT",
      "status": "DELIVERED",
      "createdAt": "2024-04-24T10:20:00Z"
    }
  }
}
```

#### 5b. Vehicle Owner Responds
**Endpoint:** `POST {{base_url}}/messages`  
**Auth:** Bearer {{token_owner}}

```json
{
  "bookingId": "{{booking_id}}",
  "content": "Vehicle is in excellent condition. Regular service done last month. All documents are updated and verified.",
  "messageType": "TEXT"
}
```

#### 5c. Get Conversation History
**Endpoint:** `GET {{base_url}}/messages/booking/{{booking_id}}?page=1&limit=50`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "msg_001",
        "senderId": "transporter_456",
        "senderName": "XYZ Logistics",
        "content": "Hi! Can you provide more details...",
        "messageType": "TEXT",
        "status": "READ",
        "createdAt": "2024-04-24T10:20:00Z"
      },
      {
        "id": "msg_002",
        "senderId": "owner_123",
        "senderName": "ABC Transport",
        "content": "Vehicle is in excellent condition...",
        "messageType": "TEXT",
        "status": "DELIVERED",
        "createdAt": "2024-04-24T10:22:00Z"
      }
    ]
  }
}
```

---

### Step 6: Negotiation - Send Price Proposal

#### 6a. Transporter Proposes Lower Price
**Endpoint:** `POST {{base_url}}/messages`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "bookingId": "{{booking_id}}",
  "content": "Can you consider 48000? That would work better for our logistics.",
  "messageType": "PRICE_PROPOSAL",
  "proposedPrice": 48000
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Price proposal submitted",
  "data": {
    "message": {
      "id": "msg_003",
      "bookingId": "booking_123456",
      "messageType": "PRICE_PROPOSAL",
      "proposedPrice": 48000,
      "status": "DELIVERED"
    }
  }
}
```

#### 6b. Also Update Booking with Proposed Price
**Endpoint:** `PUT {{base_url}}/vehicle-bookings/{{booking_id}}/propose-price`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "proposedPrice": 48000,
  "message": "Can you consider 48000? That would work better for our logistics."
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Price proposal sent successfully",
  "data": {
    "booking": {
      "id": "booking_123456",
      "status": "NEGOTIATING",
      "estimatedPrice": 50000,
      "lastPriceProposal": {
        "proposedBy": "transporter_456",
        "proposedPrice": 48000,
        "proposedAt": "2024-04-24T10:25:00Z"
      },
      "negotiationRound": 1
    }
  }
}
```

#### 6c. Vehicle Owner Counter-Proposes
**Endpoint:** `PUT {{base_url}}/vehicle-bookings/{{booking_id}}/propose-price`  
**Auth:** Bearer {{token_owner}}

```json
{
  "proposedPrice": 49000,
  "message": "Best I can do is 49000. This covers my costs and maintenance warranty."
}
```

---

### Step 7: Accept Booking

**Endpoint:** `PUT {{base_url}}/vehicle-bookings/{{booking_id}}/accept`  
**Auth:** Bearer {{token_owner}}

```json
{
  "agreedPrice": 49000,
  "message": "Great! Let's proceed with this price."
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Booking confirmed successfully",
  "data": {
    "booking": {
      "id": "booking_123456",
      "status": "CONFIRMED",
      "estimatedPrice": 50000,
      "agreedPrice": 49000,
      "confirmedAt": "2024-04-24T10:30:00Z",
      "buyerId": "transporter_456",
      "sellerId": "owner_123",
      "vehicleId": "vehicle_id_1"
    }
  }
}
```

---

### Step 8: View Booking Details

**Endpoint:** `GET {{base_url}}/vehicle-bookings/{{booking_id}}`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "success": true,
  "data": {
    "booking": {
      "id": "booking_123456",
      "postId": "post_123456",
      "vehicleId": "vehicle_id_1",
      "buyerId": {
        "id": "transporter_456",
        "name": "XYZ Logistics",
        "mobile": "8888888888"
      },
      "sellerId": {
        "id": "owner_123",
        "name": "ABC Transport",
        "mobile": "9999999999"
      },
      "status": "CONFIRMED",
      "estimatedPrice": 50000,
      "agreedPrice": 49000,
      "negotiationRound": 2,
      "lastPriceProposal": {
        "proposedBy": "owner_123",
        "proposedPrice": 49000,
        "proposedAt": "2024-04-24T10:27:00Z"
      },
      "confirmedAt": "2024-04-24T10:30:00Z"
    },
    "messages": [
      // All conversation messages
    ]
  }
}
```

---

### Step 9: Get My Bookings

**Endpoint:** `GET {{base_url}}/vehicle-bookings/my-bookings?role=buyer&status=CONFIRMED`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "success": true,
  "message": "Bookings retrieved successfully",
  "data": {
    "bookings": [
      {
        "id": "booking_123456",
        "vehicleId": {
          "vehicleNumber": "MH01AB1234",
          "vehicleType": "TANKER"
        },
        "sellerId": {
          "name": "ABC Transport"
        },
        "agreedPrice": 49000,
        "status": "CONFIRMED",
        "unreadMessageCount": 0
      }
    ],
    "total": 1
  }
}
```

---

### Step 10: Create Trip from Booking

**Endpoint:** `POST {{base_url}}/trips`  
**Auth:** Bearer {{token_owner}}

```json
{
  "vehicleId": "{{vehicle_id}}",
  "driverId": "driver_123",
  "origin": "Mumbai",
  "destination": "Delhi",
  "loadType": "Fuel",
  "quantity": 25000,
  "unit": "Liters",
  "pickupLocation": {
    "name": "XYZ Fuel Station Mumbai",
    "address": "Mahim, Mumbai"
  },
  "dropLocation": {
    "name": "ABC Fuel Station Delhi",
    "address": "NOIDA, Delhi"
  },
  "bookingId": "{{booking_id}}"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Trip created",
  "data": {
    "trip": {
      "id": "trip_789012",
      "vehicleNumber": "MH01AB1234",
      "driverId": "driver_123",
      "origin": "Mumbai",
      "destination": "Delhi",
      "status": "CREATED",
      "bookingId": "booking_123456",
      "createdAt": "2024-04-24T10:45:00Z"
    }
  }
}
```

**Save Response:**
- `trip.id` → `{{trip_id}}`

---

### Step 11: Start Trip

**Endpoint:** `PUT {{base_url}}/trips/{{trip_id}}/start`  
**Auth:** Bearer {{token_owner}}

```json
{
  "startLocation": {
    "latitude": 19.0760,
    "longitude": 72.8777
  },
  "estimatedEndTime": "2024-04-26T18:00:00Z"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Trip started",
  "data": {
    "trip": {
      "id": "trip_789012",
      "status": "IN_PROGRESS",
      "startedAt": "2024-04-24T11:00:00Z",
      "startLocation": {
        "latitude": 19.0760,
        "longitude": 72.8777
      },
      "estimatedEndTime": "2024-04-26T18:00:00Z"
    }
  }
}
```

---

## Alternative Scenarios

### Scenario: Rejection Flow

#### Step 1-4: Same as above (up to booking creation)

#### Step 5: Vehicle Owner Rejects Booking
**Endpoint:** `PUT {{base_url}}/vehicle-bookings/{{booking_id}}/reject`  
**Auth:** Bearer {{token_owner}}

```json
{
  "reason": "Vehicle already booked by another party for those dates"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Booking rejected",
  "data": {
    "booking": {
      "id": "booking_123456",
      "status": "REJECTED",
      "rejectedAt": "2024-04-24T10:35:00Z",
      "rejectReason": "Vehicle already booked by another party for those dates"
    }
  }
}
```

---

### Scenario: Buyer Cancels Booking

**Endpoint:** `DELETE {{base_url}}/vehicle-bookings/{{booking_id}}`  
**Auth:** Bearer {{token_transporter}}

```json
{
  "reason": "Found another vehicle with better pricing"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Booking cancelled successfully",
  "data": {
    "booking": {
      "id": "booking_123456",
      "status": "CANCELLED",
      "cancelledAt": "2024-04-24T10:40:00Z"
    }
  }
}
```

---

## Environment Variables Setup

Create a Postman environment with these variables:

```json
{
  "name": "Vehicle Booking API",
  "values": [
    {
      "key": "base_url",
      "value": "http://localhost:3000/api",
      "type": "string"
    },
    {
      "key": "token_owner",
      "value": "",
      "type": "string"
    },
    {
      "key": "token_transporter",
      "value": "",
      "type": "string"
    },
    {
      "key": "vehicle_id",
      "value": "",
      "type": "string"
    },
    {
      "key": "vehicle_type_id",
      "value": "",
      "type": "string"
    },
    {
      "key": "post_id",
      "value": "",
      "type": "string"
    },
    {
      "key": "booking_id",
      "value": "",
      "type": "string"
    },
    {
      "key": "trip_id",
      "value": "",
      "type": "string"
    }
  ]
}
```

---

## Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| 403 Unauthorized | Missing or invalid token | Login again and update token variable |
| 400 Bad Request | Invalid vehicle ID | Use correct vehicle ID from previous responses |
| 404 Not Found | Resource doesn't exist | Verify post_id/booking_id/trip_id |
| 400 Cannot book own vehicle | Buyer and seller are same | Use different accounts for testing |
| 400 Booking already exists | Duplicate booking for same post | Cancel previous booking first |

---

## WebSocket Events to Monitor

While testing, monitor these socket events in console:

```javascript
// When post is created
socket.on('vehiclePost:created', (data) => {
  console.log('New post available:', data);
});

// When booking is requested
socket.on('booking:requested', (data) => {
  console.log('Booking request received:', data);
});

// When new message arrives
socket.on('message:new', (data) => {
  console.log('New message:', data);
});

// When price is proposed
socket.on('booking:price-proposed', (data) => {
  console.log('Price proposal received:', data);
});

// When booking is confirmed
socket.on('booking:confirmed', (data) => {
  console.log('Booking confirmed:', data);
});

// When booking is rejected
socket.on('booking:rejected', (data) => {
  console.log('Booking rejected:', data);
});

// When trip starts
socket.on('trip:started', (data) => {
  console.log('Trip started:', data);
});
```

---

## Performance Testing

### Load Testing Recommendations

```bash
# Using Apache Bench
ab -n 1000 -c 100 http://localhost:3000/api/vehicle-posts

# Using Apache JMeter
- Create thread group with 100 users
- Set ramp-up time to 60 seconds
- Create HTTP samplers for each endpoint
- Add assertions for response codes

# Using k6
k6 run load-test.js --vus 50 --duration 5m
```

---

## Notes

- All timestamps are in ISO 8601 format
- Prices are in INR currency
- Pagination defaults: page=1, limit=20
- Date filtering matches availability range intersection
- Message status: SENT → DELIVERED → READ
- Booking status: REQUESTED → NEGOTIATING → CONFIRMED → COMPLETED
