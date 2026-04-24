# Vehicle Booking Workflow - Database Schema Reference

## Overview
This document provides detailed database schema information for the vehicle booking workflow.

---

## Collection: VehicleRouteAvailability

Represents vehicle availability posts created by transporters.

```javascript
{
  "_id": ObjectId,
  
  // Ownership
  "transporterId": ObjectId,        // Reference to Transporter
  "vehicleId": ObjectId,            // Reference to Vehicle (optional)
  
  // Route Information
  "vehicleType": String,            // TANKER, TRUCK, FLATBED, etc.
  "origin": String,                 // Starting location (required)
  "destination": String,            // End location (optional, can be null)
  
  // Availability
  "availableFrom": Date,            // Start availability date
  "availableTo": Date,              // End availability date
  
  // Inventory
  "quantity": Number,               // Total slots available (default: 1)
  "slotsLeft": Number,              // Remaining available slots
  
  // Pricing
  "pricePerVehicle": Number,        // Price per vehicle/slot (can be null)
  
  // Additional Info
  "note": String,                   // Description/notes about vehicle (optional)
  "status": String,                 // active, cancelled (enum)
  
  // Timestamps
  "createdAt": Date,
  "updatedAt": Date
}
```

### Indexes
```javascript
{
  "transporterId": 1,
  "status": 1,
  "vehicleType": 1,
  "availableFrom": 1,
  "availableTo": 1,
  "createdAt": -1
}
```

### Notes
- Location fields support flexible regex matching for searches
- Date range must be validated: availableFrom <= availableTo
- Slots are decremented when booking is confirmed
- Status "cancelled" posts are not visible in searches
- Compound query uses $and for multiple filters

---

## Collection: VehicleRouteAssignment

Represents specific vehicle assignments to posts (allows multiple vehicles per post).

```javascript
{
  "_id": ObjectId,
  
  // References
  "postId": ObjectId,               // Reference to VehicleRouteAvailability
  "vehicleId": ObjectId,            // Reference to Vehicle
  "transporterId": ObjectId,        // Reference to Transporter (vehicle owner)
  
  // Pricing
  "price": Number,                  // Price for this specific vehicle
  
  // Status
  "status": String,                 // active, assigned, completed
  
  // Timestamps
  "createdAt": Date,
  "updatedAt": Date
}
```

### Indexes
```javascript
{
  "postId": 1,
  "vehicleId": 1,
  "transporterId": 1,
  "status": 1
}
```

---

## Collection: VehicleBooking

Represents booking requests between transporters.

```javascript
{
  "_id": ObjectId,
  
  // References (from post)
  "postId": ObjectId,               // Reference to VehicleRouteAvailability
  "assignmentId": ObjectId,         // Reference to VehicleRouteAssignment
  "vehicleId": ObjectId,            // Reference to Vehicle
  
  // Parties
  "buyerId": ObjectId,              // Reference to Transporter (booking requester)
  "sellerId": ObjectId,             // Reference to Transporter (vehicle owner)
  
  // Status
  "status": String,                 // enum: [REQUESTED, NEGOTIATING, CONFIRMED, 
                                     //        COMPLETED, CANCELLED, REJECTED]
  
  // Pricing
  "estimatedPrice": Number,         // Initial asking price
  "agreedPrice": Number,            // Final negotiated price (null until confirmed)
  
  // Negotiation
  "negotiationRound": Number,       // Number of price proposals (default: 0)
  "lastPriceProposal": {
    "proposedBy": ObjectId,         // Reference to Transporter who proposed
    "proposedPrice": Number,        // Proposed price
    "proposedAt": Date
  },
  
  // Trip Integration
  "tripId": ObjectId,               // Reference to Trip (after trip creation)
  
  // Workflow Timestamps
  "acceptedAt": Date,               // When seller accepted (deprecated, use confirmedAt)
  "confirmedAt": Date,              // When booking was confirmed
  "rejectedAt": Date,               // When booking was rejected
  "rejectReason": String,           // Reason for rejection
  "completedAt": Date,              // When trip completed
  
  // Payment
  "paymentStatus": String,          // enum: [PENDING, HOLD, COMPLETED, REFUNDED]
  
  // Additional
  "note": String,                   // Additional notes/terms
  "notificationsSent": [String],    // Array of notification types sent
  
  // Timestamps
  "createdAt": Date,
  "updatedAt": Date
}
```

### Indexes
```javascript
{
  "buyerId": 1,
  "status": 1
}
{
  "sellerId": 1,
  "status": 1
}
{
  "postId": 1,
  "status": 1
}
{
  "buyerId": 1,
  "sellerId": 1
}
{
  "createdAt": -1
}
{
  "tripId": 1
}
```

### Status Transitions
```
REQUESTED (initial state)
    ↓
NEGOTIATING (when price proposal sent)
    ↓
CONFIRMED (when seller accepts)
    ↓
COMPLETED (when trip finishes)

OR

REQUESTED → REJECTED (seller rejects)
REQUESTED/NEGOTIATING → CANCELLED (buyer cancels)
```

### Notes
- Only one pending/confirmed booking per buyer per post
- Both parties can propose prices in REQUESTED/NEGOTIATING states
- Seller must confirm to move to CONFIRMED
- Trip creation links booking to trip via tripId

---

## Collection: TransporterMessage

Represents all messages in booking conversations.

```javascript
{
  "_id": ObjectId,
  
  // Context
  "bookingId": ObjectId,            // Reference to VehicleBooking
  
  // Participants
  "senderId": ObjectId,             // Reference to Transporter (sender)
  "receiverId": ObjectId,           // Reference to Transporter (receiver)
  
  // Message Content
  "messageType": String,            // enum: [TEXT, PRICE_PROPOSAL, PRICE_COUNTER,
                                     //        ACCEPTED, REJECTED, SYSTEM]
  "content": String,                // Message body (required, trimmed)
  
  // Price Information (for PRICE_PROPOSAL/PRICE_COUNTER)
  "proposedPrice": Number,          // Proposed price (null if not proposal)
  
  // Message Status
  "status": String,                 // enum: [SENT, DELIVERED, READ]
  "readAt": Date,                   // When message was read
  
  // Attachments
  "attachments": [String],          // Array of file URLs
  
  // Timestamps
  "createdAt": Date,
  "updatedAt": Date
}
```

### Indexes
```javascript
{
  "bookingId": 1,
  "createdAt": -1
}
{
  "senderId": 1,
  "receiverId": 1,
  "bookingId": 1
}
{
  "status": 1,
  "createdAt": -1
}
{
  "readAt": 1
}
{
  "receiverId": 1,
  "status": 1
}
```

### Message Types
- **TEXT**: Regular conversation message
- **PRICE_PROPOSAL**: Initial price offer with proposedPrice field
- **PRICE_COUNTER**: Counter-offer with proposedPrice field
- **ACCEPTED**: Agreement to terms
- **REJECTED**: Rejection of terms
- **SYSTEM**: Automated system notifications

### Notes
- Status progression: SENT → DELIVERED → READ (optional)
- readAt is set when status changed to READ
- Messages are immutable after creation
- Sender and receiver are always opposite parties of booking

---

## Collection: VehicleBookingAudit

Audit trail for all booking actions.

```javascript
{
  "_id": ObjectId,
  
  // Reference
  "bookingId": ObjectId,            // Reference to VehicleBooking
  
  // Action
  "action": String,                 // enum: [CREATED, PRICE_PROPOSED, CONFIRMED,
                                     //        REJECTED, CANCELLED, COMPLETED]
  
  // Who performed action
  "performedBy": ObjectId,          // Reference to Transporter
  
  // Action details
  "details": {
    // Action-specific information
    // For CREATED: { postId, assignmentId, estimatedPrice }
    // For PRICE_PROPOSED: { proposedPrice, negotiationRound }
    // For CONFIRMED: { agreedPrice }
    // For REJECTED: { reason }
  },
  
  // Timestamps
  "createdAt": Date
}
```

### Notes
- Immutable audit log
- Useful for compliance and troubleshooting
- Can be used to reconstruct booking history

---

## Collection: VehicleRouteAvailability (Search Index)

For efficient searching, ensure indexes support:

```javascript
// Geo-spatial searching (future enhancement)
"locationIndex": "2dsphere"

// Text search on notes/descriptions
"textIndex": {
  "note": "text",
  "vehicleType": "text"
}
```

---

## Data Model Relationships

```
┌─────────────────────────────────────────────┐
│ Transporter (Vehicle Owner)                 │
└────────────────┬────────────────────────────┘
                 │
                 │ creates
                 ↓
┌─────────────────────────────────────────────┐
│ VehicleRouteAvailability (Post)             │
│ - vehicleType                               │
│ - origin, destination                       │
│ - pricePerVehicle                           │
└────────┬─────────────────────────────────────┘
         │
         │ contains
         ↓
┌─────────────────────────────────────────────┐
│ VehicleRouteAssignment                      │
│ - vehicleId                                 │
│ - price                                     │
└────────┬─────────────────────────────────────┘
         │
         │ references
         ↓
┌─────────────────────────────────────────────┐
│ VehicleBooking (Booking Request)            │
│ - buyerId (Transporter seeking vehicle)     │
│ - sellerId (Vehicle Owner)                  │
│ - estimatedPrice/agreedPrice                │
│ - negotiationRound                          │
└────────┬─────────────────────────────────────┘
         │
         ├─ sends
         │  ↓
         │ ┌─────────────────────────────────┐
         │ │ TransporterMessage (Chat)       │
         │ │ - messageType                   │
         │ │ - proposedPrice (if proposal)   │
         │ └─────────────────────────────────┘
         │
         └─ linked to
            ↓
         ┌─────────────────────────────────┐
         │ Trip (After confirmation)       │
         │ - vehicleId                     │
         │ - driverId                      │
         │ - status: IN_PROGRESS           │
         └─────────────────────────────────┘
```

---

## Booking State Diagram

```
                    ┌─────────────┐
                    │  REQUESTED  │
                    └──────┬──────┘
                           │
                ┌──────────┼──────────┐
                │          │          │
                ▼          ▼          ▼
            REJECTED   NEGOTIATING CANCELLED
                       │
                       │ (when seller accepts)
                       ▼
                   CONFIRMED
                       │
                       │ (when trip completes)
                       ▼
                   COMPLETED
```

---

## Booking Workflow SQL-like Queries

### Find active bookings for a transporter
```javascript
db.collection('VehicleBooking').find({
  $or: [
    { buyerId: transporterId },
    { sellerId: transporterId }
  ],
  status: { $in: ['REQUESTED', 'NEGOTIATING', 'CONFIRMED'] }
})
```

### Get negotiation history
```javascript
db.collection('TransporterMessage').find({
  bookingId: bookingId,
  messageType: { $in: ['PRICE_PROPOSAL', 'PRICE_COUNTER'] }
}).sort({ createdAt: 1 })
```

### Find posts with available slots
```javascript
db.collection('VehicleRouteAvailability').find({
  status: 'active',
  slotsLeft: { $gt: 0 },
  availableFrom: { $lte: filterDate },
  availableTo: { $gte: filterDate }
})
```

### Get unread messages
```javascript
db.collection('TransporterMessage').find({
  receiverId: userId,
  status: { $ne: 'READ' }
})
```

---

## Data Migration Considerations

### When Adding New Fields

```javascript
// Example: Adding paymentStatus if not present
db.collection('VehicleBooking').updateMany(
  { paymentStatus: { $exists: false } },
  { $set: { paymentStatus: 'PENDING' } }
)
```

### Backfilling Timestamps
```javascript
db.collection('VehicleBooking').updateMany(
  { confirmedAt: { $exists: false }, status: 'CONFIRMED' },
  { $set: { confirmedAt: new Date() } }
)
```

---

## Performance Optimization Tips

1. **Pagination**: Always use skip/limit for large result sets
2. **Projection**: Only retrieve needed fields
3. **Indexing**: Ensure all query filters have indexes
4. **Aggregation**: Use MongoDB aggregation for complex queries
5. **Caching**: Cache frequently accessed post details
6. **Archiving**: Archive completed bookings to archive collection

### Slow Query Monitoring
```javascript
// Enable profiling
db.setProfilingLevel(1, { slowms: 100 })

// View slow queries
db.system.profile.find({ millis: { $gt: 100 } })
```

---

## Backup & Recovery

### Daily Backup Command
```bash
mongodump --db porttivo --out ./backups/backup_$(date +%Y%m%d_%H%M%S)
```

### Restore Command
```bash
mongorestore --db porttivo ./backups/backup_20240424/porttivo
```

---

## Data Validation Rules

| Field | Type | Validation | Required |
|-------|------|-----------|----------|
| transporterId (VehicleRouteAvailability) | ObjectId | Must exist in Transporter collection | Yes |
| vehicleType | String | Must exist in VehicleType collection | Yes |
| origin | String | Non-empty, max 200 chars | Yes |
| destination | String | Non-empty, max 200 chars | No |
| pricePerVehicle | Number | Min 0, must be finite number | No |
| quantity | Number | Min 1, integer | Yes |
| availableFrom | Date | Must be valid ISO date | Yes |
| availableTo | Date | Must be >= availableFrom | Yes |
| estimatedPrice | Number | Min 0, must be finite | Yes |
| agreedPrice | Number | Min 0, must be finite | No |
| negotiationRound | Number | Non-negative integer, max 20 | Yes |

---

## Related Collections Reference

- **Transporter**: User accounts for transporters
- **Vehicle**: Vehicle details (linked via vehicleId)
- **VehicleType**: Vehicle type catalog (TANKER, TRUCK, etc.)
- **Trip**: Trip execution records (linked via tripId)
- **Driver**: Driver information (linked in Trip)
- **Notification**: System notifications
