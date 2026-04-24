# Vehicle Booking Workflow - Visual Flow Diagrams

## Complete Workflow Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    VEHICLE BOOKING WORKFLOW                          │
└─────────────────────────────────────────────────────────────────────┘

1. POST VEHICLE
   └─> Vehicle Owner creates availability post
       ├─ Set location (origin, destination)
       ├─ Set dates (availableFrom, availableTo)
       ├─ Set pricing (pricePerVehicle)
       └─ Post becomes ACTIVE and visible

2. SEARCH FOR VEHICLES
   └─> Transporter searches for posts
       ├─ Filter by location, date, type
       ├─ See all active posts matching criteria
       └─ View post details and pricing

3. INITIATE CHAT
   └─> Create booking request (REQUESTED)
       ├─ Transporter: "I'm interested in booking"
       ├─ Vehicle Owner: Receives booking notification
       └─ Booking status: REQUESTED

4. NEGOTIATION
   └─> Both parties communicate and propose prices
       ├─ Send messages with price proposals
       ├─ Booking status: NEGOTIATING
       ├─ Track proposal rounds
       └─ Messages linked to booking

5. BOOK VEHICLE (CONFIRMATION)
   └─> Vehicle Owner accepts/rejects
       ├─ Accept: Status → CONFIRMED, agreedPrice set
       ├─ Reject: Status → REJECTED, reason recorded
       └─ Both parties notified

6. START TRIP
   └─> Create and initiate trip
       ├─ Create trip linked to booking
       ├─ Assign vehicle and driver
       ├─ Start trip: Status → IN_PROGRESS
       └─ Trip begins, location tracking active
```

---

## Booking State Machine

```
                    ┌───────────┐
                    │ REQUESTED │  ← Booking created
                    └─────┬─────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
          ▼               ▼               ▼
      REJECTED        NEGOTIATING     CANCELLED
      (Seller         (Multiple        (Buyer
       rejects)       price rounds)    cancels)
                          │
                          │ (Seller accepts)
                          ▼
                      ┌─────────┐
                      │CONFIRMED│
                      └────┬────┘
                           │
                           │ (Trip completes)
                           ▼
                      ┌─────────┐
                      │COMPLETED│
                      └─────────┘

Status Transitions:
  • REQUESTED → NEGOTIATING  (when price proposed)
  • REQUESTED → REJECTED      (seller rejects)
  • REQUESTED → CANCELLED     (buyer cancels)
  • NEGOTIATING → CONFIRMED   (seller accepts)
  • NEGOTIATING → REJECTED    (seller rejects)
  • NEGOTIATING → CANCELLED   (buyer cancels)
  • CONFIRMED → COMPLETED     (trip finishes)
```

---

## Message Type Flow

```
BOOKING CONVERSATION

Transporter                          Vehicle Owner
    │                                    │
    ├─ TEXT: "Hi, interested"          │
    │─────────────────────────────────>│
    │                                    │
    │ <─ TEXT: "Sure, details available"│
    │<─────────────────────────────────┤
    │                                    │
    ├─ PRICE_PROPOSAL: 48000 (↓5%)    │
    │─────────────────────────────────>│
    │                                    │
    │ <─ PRICE_COUNTER: 49000 (↓2%)   │
    │<─────────────────────────────────┤
    │                                    │
    ├─ ACCEPTED: "Let's go with 49000" │
    │─────────────────────────────────>│
    │                                    │
    │ <─ SYSTEM: "Booking confirmed!"   │
    │<─────────────────────────────────┤

Message Types:
  • TEXT: Regular conversation
  • PRICE_PROPOSAL: Initial price offer
  • PRICE_COUNTER: Counter-offer
  • ACCEPTED: Agreement to terms
  • REJECTED: Rejection
  • SYSTEM: Automated notification

Message Status Progression:
  SENT ─> DELIVERED ─> READ
```

---

## Data Relationships

```
┌──────────────────────┐
│   TRANSPORTER        │
│   (Vehicle Owner)    │
└──────────┬───────────┘
           │ creates
           ▼
┌──────────────────────────────────────┐
│   VEHICLEROUTEAVAILABILITY (Post)    │
│   • origin, destination              │
│   • vehicleType, quantity            │
│   • pricePerVehicle                  │
│   • availableFrom/To                 │
│   • status: active/cancelled         │
└──────────┬───────────────────────────┘
           │ contains
           ▼
┌──────────────────────────────────────┐
│   VEHICLEROUTEASSIGNMENT             │
│   • vehicleId                        │
│   • price                            │
└──────────┬───────────────────────────┘
           │ referenced in
           ▼
┌──────────────────────────────────────┐
│   VEHICLEBOOKING                     │
│   • buyerId (Transporter booking)    │
│   • sellerId (Vehicle owner)         │
│   • estimatedPrice                   │
│   • agreedPrice                      │
│   • status (REQUESTED→CONFIRMED)     │
│   • negotiationRound                 │
│   • lastPriceProposal                │
└──────────┬───────────────────────────┘
           │                │
    ┌──────▼─────┐   ┌─────▼─────────┐
    │  Messages  │   │  Audit Log    │
    │  Workflow: │   │  of Actions   │
    │  • TEXT    │   │  • CREATED    │
    │  • PROPOSAL│   │  • CONFIRMED  │
    │  • READ    │   │  • REJECTED   │
    └────────────┘   └───────────────┘
           │
           │ linked to
           ▼
    ┌──────────────────┐
    │  TRIP            │
    │  • vehicleId     │
    │  • driverId      │
    │  • status        │
    │  • startLocation │
    └──────────────────┘
```

---

## User Interaction Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    VEHICLE OWNER (Seller)                     │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
           1. POST VEHICLE AVAILABILITY
              ├─ Vehicle details
              ├─ Pricing: 50000
              └─ Dates: May 1-15

                       │
        ┌──────────────▼──────────────┐
        │  Post is ACTIVE & VISIBLE   │
        └──────────────┬──────────────┘
                       │
                       ▼
        2. RECEIVE BOOKING REQUEST
           From: XYZ Logistics (Transporter)
           Vehicle: TANKER MH01AB1234
           Price: 50000

                       │
        ┌──────────────▼──────────────┐
        │    REVIEW & RESPOND         │
        └──────────────┬──────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
   3a. NEGOTIATE             3b. REJECT/ACCEPT
   Counter: 49000            └─ Booking ends
   │
   │ ┌─────────────────────────────┐
   │ │ Send Counter-Proposal       │
   │ │ "Best I can do: 49000"      │
   │ └─────────────────────────────┘
   │
   ▼
   4. RECEIVE ACCEPTANCE
   "Let's go with 49000"

   Status: CONFIRMED ✓
   Price: 49000

   │
   ▼
   5. CREATE TRIP
   ├─ Vehicle: TANKER MH01AB1234
   ├─ Driver: John Doe
   ├─ Route: Mumbai→Delhi
   └─ Status: CREATED

   │
   ▼
   6. START TRIP
   └─ Trip Status: IN_PROGRESS


┌──────────────────────────────────────────────────────────────┐
│                    TRANSPORTER (Buyer)                        │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
           1. SEARCH FOR VEHICLES
              ├─ Query: TANKER
              ├─ Route: Mumbai→Delhi
              └─ Date: May 1-15

                       │
        ┌──────────────▼──────────────┐
        │  VIEW RESULTS (Posts)       │
        │  • ABC Transport            │
        │  • Price: 50000             │
        │  • Rating: 4.5⭐            │
        └──────────────┬──────────────┘
                       │
                       ▼
        2. VIEW POST DETAILS
           Click on post to see:
           ├─ Vehicle condition
           ├─ Owner reviews
           ├─ Exact pricing
           └─ Availability period

                       │
        ┌──────────────▼──────────────┐
        │    CREATE BOOKING REQUEST   │
        │    Status: REQUESTED        │
        └──────────────┬──────────────┘
                       │
        3. SEND MESSAGE & NEGOTIATE
           ├─ "Can you do 48000?"
           ├─ Receive Counter: 49000
           └─ "OK, let's do 49000"

                       │
        ┌──────────────▼──────────────┐
        │  ACCEPT BOOKING (if buyer)  │
        │  OR                         │
        │  WAIT FOR SELLER CONFIRMATION
        └──────────────┬──────────────┘
                       │
                       ▼
        4. BOOKING CONFIRMED ✓
           Status: CONFIRMED
           Price: 49000
           
                       │
                       ▼
        5. WAIT FOR TRIP CREATION
           Seller creates trip with your booking

                       │
                       ▼
        6. RECEIVE TRIP NOTIFICATION
           Trip: ID 789012
           Vehicle: MH01AB1234
           Status: Ready to start
```

---

## API Call Sequence Diagram

```
Transporter/Buyer          Server                Vehicle Owner/Seller

    │
    ├─────────────────────────────────────────────────────────>
    │  POST /api/vehicle-bookings
    │  { postId, assignmentId }
    │
    │<──────────────────────────────────────────────────────────
    │  201 { booking: { id, status: REQUESTED } }
    │
    │  (Booking created)
    │
    │  EVENT: booking:requested
    │  (Sent to Vehicle Owner via Socket)
    │
    │                                       ↓ (Receives socket event)
    │                                       Vehicle Owner notified
    │
    │  (In Chat/Message Interface)
    ├─────────────────────────────────────────────────────────>
    │  POST /api/messages
    │  { bookingId, content, messageType: TEXT }
    │
    │<──────────────────────────────────────────────────────────
    │  201 { message: { id, status: DELIVERED } }
    │
    │  EVENT: message:new
    │  (Sent to both parties via Socket)
    │
    │                                       ↓ (Receives message)
    │                                       Vehicle Owner sees message
    │
    │                                       ├────────────────────>
    │                                       POST /api/messages
    │                                       { ..., messageType: PRICE_COUNTER,
    │                                         proposedPrice: 49000 }
    │
    │<─────────────────────────────────────┤
    │  201 { message: { ... } }
    │  EVENT: message:new, booking:price-proposed
    │
    │  ↓ (Receives counter proposal)
    │  Transporter sees 49000 offer
    │
    ├─────────────────────────────────────────────────────────>
    │  POST /api/messages
    │  { bookingId, content: "OK, 49000", messageType: ACCEPTED }
    │
    │<──────────────────────────────────────────────────────────
    │  201 { message: { ... } }
    │  EVENT: message:new
    │
    │  (Agreement reached)
    │
    │                                       ├────────────────────>
    │                                       PUT /api/vehicle-bookings/:id/accept
    │                                       { agreedPrice: 49000 }
    │
    │<─────────────────────────────────────┤
    │  200 { booking: { status: CONFIRMED, agreedPrice: 49000 } }
    │  EVENT: booking:confirmed
    │
    │  ↓ Both parties notified of confirmation
    │
    │                                       ├────────────────────>
    │                                       POST /api/trips
    │                                       { bookingId, vehicleId,
    │                                         driverId, ... }
    │
    │<─────────────────────────────────────┤
    │  201 { trip: { id, status: CREATED } }
    │
    │                                       ├────────────────────>
    │                                       PUT /api/trips/:id/start
    │                                       { startLocation, ... }
    │
    │<─────────────────────────────────────┤
    │  200 { trip: { status: IN_PROGRESS } }
    │  EVENT: trip:started
    │
    │  ↓ Trip is now active
```

---

## Payment Flow (Future Integration)

```
Booking Confirmed
       │
       ▼
┌─────────────────────┐
│ Payment Initiated   │
│ status: PENDING     │
└────────┬────────────┘
         │
         ├─ Generate Payment Link
         │  (24-hour expiry)
         │
         ▼
┌─────────────────────┐
│ Await Payment       │
│ paymentStatus:      │
│ PAYMENT_AWAITING    │
└────────┬────────────┘
         │
         │ Customer pays via UPI/Card/Bank
         │
         ▼
┌─────────────────────┐
│ Payment Verified    │
│ paymentStatus:      │
│ COMPLETED           │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ Trip Can Start      │
│ Booking Ready       │
└─────────────────────┘
```

---

## Error Handling Flow

```
API Request
    │
    ▼
┌─────────────────────┐
│ Validate Input      │
└────────┬────────────┘
         │
    ┌────┴────┐
    │          │
 Valid      Invalid
    │          │
    ▼          ▼
   │         400: Bad Request
   │         └─ Field missing
   │         └─ Invalid format
   │         └─ Value out of range
   │
   ▼
┌──────────────────────┐
│ Check Authorization  │
└────────┬─────────────┘
         │
    ┌────┴────┐
    │          │
 Valid    Invalid
    │          │
    ▼          ▼
   │         401: Unauthorized
   │         └─ Missing token
   │         └─ Invalid token
   │
   ▼
┌──────────────────────┐
│ Check Permissions    │
└────────┬─────────────┘
         │
    ┌────┴────┐
    │          │
 Valid    Invalid
    │          │
    ▼          ▼
   │         403: Forbidden
   │         └─ Not seller
   │         └─ Not buyer
   │         └─ Not owner
   │
   ▼
┌──────────────────────┐
│ Validate Business    │
│ Logic                │
└────────┬─────────────┘
         │
    ┌────┴────┐
    │          │
 Valid    Invalid
    │          │
    ▼          ▼
   │         400: Conflict
   │         └─ Can't book own
   │         └─ Already booked
   │         └─ Status invalid
   │
   ▼
┌──────────────────────┐
│ Execute Operation    │
└────────┬─────────────┘
         │
    ┌────┴────┐
    │          │
Success    Failure
    │          │
    ▼          ▼
   │         500: Server Error
   │         └─ DB error
   │         └─ Timeout
   │         └─ Socket error
   │
   ▼
┌──────────────────────┐
│ Send Response        │
│ 200/201              │
└──────────────────────┘
```

---

## Real-Time Event Architecture

```
Browser 1 (Transporter)    WebSocket Server    Browser 2 (Vehicle Owner)
         │                        │                       │
         ├─ Connect              │                       │
         │─ join room ──────────>│                       │
         │                        │ <─── Connect         │
         │                        │       join room ────┤
         │                        │                       │
         │ Create booking ───────>│                       │
         │ POST /api/vehicle      │ EVENT:               │
         │ -bookings              │ booking:requested    │
         │                        ├──────────────────────>│
         │                        │ (Notification)       │
         │                        │                       │
         │ Send message ─────────>│ EVENT: message:new   │
         │ POST /api/messages     ├──────────────────────>│
         │                        │ (Delivers message)   │
         │                        │                       │
         │                        │<──── Send counter    │
         │ EVENT: message:new     │      message         │
         │<───────────────────────┤      POST /api/      │
         │ (Receives counter)     │      messages        │
         │                        │                       │
         │ POST /api/messages     │ EVENT: message:new   │
         │ (Accept message) ────->│                       │
         │                        ├──────────────────────>│
         │                        │                       │
         │ EVENT: booking:confirmed
         │<───────────────────────┤───────────────────────>│
         │ (Booking confirmed)    │ EVENT: booking:confirmed
         │                        │ (Booking confirmed)   │

Socket Rooms:
  • transporter:{userId}  - For individual notifications
  • booking:{bookingId}   - For booking participants
  • vehiclePost:public    - For new post broadcasts
```

---

## Database Query Examples

### Find Vehicle Posts
```
Query: Location filtering
db.vehiclerouteavailability.find({
  status: 'active',
  $or: [
    { origin: /mumbai/i },
    { destination: /mumbai/i }
  ],
  availableFrom: { $lte: filterDate },
  availableTo: { $gte: filterDate }
})
```

### Get Booking Conversation
```
Query: Message retrieval with user check
db.transportermessage.find({
  bookingId: ObjectId("booking_id"),
  $or: [
    { senderId: userId },
    { receiverId: userId }
  ]
}).sort({ createdAt: 1 })
```

### Get Negotiation History
```
Query: Track price proposals
db.transportermessage.find({
  bookingId: ObjectId("booking_id"),
  messageType: { $in: ['PRICE_PROPOSAL', 'PRICE_COUNTER'] }
}).sort({ createdAt: 1 })
```

---

## Timeline Example

```
2024-04-24 10:00 - ABC Transport posts TANKER availability
                   Mumbai→Delhi, May 1-15, ₹50,000

2024-04-24 10:15 - XYZ Logistics sees post in search results

2024-04-24 10:20 - XYZ Logistics creates booking request
                   Status: REQUESTED

2024-04-24 10:22 - ABC Transport receives notification
                   Views booking request

2024-04-24 10:25 - XYZ Logistics sends message:
                   "Can you do ₹48,000?"
                   (PRICE_PROPOSAL)

2024-04-24 10:27 - ABC Transport counter-proposes:
                   "Best is ₹49,000"
                   (PRICE_COUNTER)

2024-04-24 10:30 - XYZ Logistics accepts:
                   "Let's go with ₹49,000"
                   Status: NEGOTIATING → CONFIRMED
                   agreedPrice: ₹49,000

2024-04-24 10:45 - ABC Transport creates trip
                   Links to booking
                   Status: CREATED

2024-04-24 11:00 - ABC Transport starts trip
                   Status: CREATED → IN_PROGRESS
                   startLocation: Mumbai coordinates

2024-04-26 18:30 - Trip reaches Delhi
                   Status: IN_PROGRESS → COMPLETED
                   Booking: COMPLETED

2024-04-26 19:00 - System prompts for review/rating
```

---

## Key Metrics Dashboard View

```
┌────────────────────────────────────────────────────────────┐
│          VEHICLE BOOKING WORKFLOW METRICS                   │
├────────────────────────────────────────────────────────────┤
│                                                              │
│  Total Posts:           142                                 │
│  Active Posts:          98    (69%)                         │
│  Completed Bookings:    156                                 │
│                                                              │
│  ┌─ Booking Status Distribution                          │
│  │  REQUESTED:      12  (8%)                             │
│  │  NEGOTIATING:    8   (5%)                             │
│  │  CONFIRMED:      22  (14%)                            │
│  │  COMPLETED:      156 (73%)                            │
│  └                                                         │
│                                                              │
│  ┌─ Negotiation Metrics                                  │
│  │  Avg. Rounds/Booking:  1.8                            │
│  │  Success Rate:         91%                            │
│  │  Avg. Discount:        ₹2,100 (4.2%)                 │
│  └                                                         │
│                                                              │
│  ┌─ Response Times                                       │
│  │  Search:        120ms                                 │
│  │  Create Booking: 180ms                                │
│  │  Send Message:   95ms                                 │
│  └                                                         │
│                                                              │
│  Top Routes:                                               │
│  1. Mumbai → Delhi      (32 bookings)                     │
│  2. Mumbai → Pune       (18 bookings)                     │
│  3. Delhi → Bangalore   (15 bookings)                     │
│                                                              │
└────────────────────────────────────────────────────────────┘
```

---

These diagrams provide visual representations of the workflow from multiple perspectives - helping with understanding, implementation, and troubleshooting.
