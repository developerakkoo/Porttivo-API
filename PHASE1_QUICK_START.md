# 🚀 Phase 1 - Quick Start & Testing Guide

## 📦 What's Ready

Phase 1 is **100% complete** with:
- ✅ 3 new MongoDB models
- ✅ 14 API endpoints (8 booking + 6 messaging)
- ✅ Real-time Socket.IO events
- ✅ Private message encryption
- ✅ Complete audit trail
- ✅ Comprehensive test suite

---

## 🎯 How to Test Phase 1

### Prerequisites
```bash
# Install dependencies (if not done)
npm install

# MongoDB must be running
# Environment variables configured in .env
```

### 1️⃣ Start the API Server
```bash
node index.js
```

Expected output:
```
🚀 Server is running on port 3000
📡 API endpoints available at:
   - Local:   http://localhost:3000/health
   - Network: http://YOUR_IP:3000/api
🔌 Socket.IO server initialized
```

---

## 🧪 Testing via Postman

### 1. Create Booking Request

**Endpoint:** `POST http://localhost:3000/api/vehicle-bookings`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json
```

**Body:**
```json
{
  "postId": "PASTE_POST_ID_HERE",
  "assignmentId": "PASTE_ASSIGNMENT_ID_HERE"
}
```

**Expected Response (201):**
```json
{
  "success": true,
  "message": "Booking request created successfully",
  "data": {
    "booking": {
      "id": "BOOKING_ID",
      "status": "REQUESTED",
      "estimatedPrice": 5000,
      "agreedPrice": null,
      "createdAt": "2024-01-15T10:00:00Z"
    }
  }
}
```

---

### 2. Send Message

**Endpoint:** `POST http://localhost:3000/api/messages`

**Headers:**
```
Authorization: Bearer BUYER_TOKEN
Content-Type: application/json
```

**Body:**
```json
{
  "bookingId": "BOOKING_ID_FROM_STEP_1",
  "content": "Hi! Interested in this truck",
  "messageType": "TEXT"
}
```

**Expected Response (201):**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "data": {
    "message": {
      "id": "MSG_ID",
      "status": "DELIVERED",
      "content": "Hi! Interested in this truck"
    }
  }
}
```

---

### 3. Propose Price

**Endpoint:** `PUT http://localhost:3000/api/vehicle-bookings/BOOKING_ID/propose-price`

**Headers:**
```
Authorization: Bearer BUYER_TOKEN
```

**Body:**
```json
{
  "proposedPrice": 4800,
  "message": "Can you do 4800/km?"
}
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "booking": {
      "status": "NEGOTIATING",
      "negotiationRound": 1,
      "lastPriceProposal": {
        "proposedPrice": 4800
      }
    }
  }
}
```

---

### 4. Accept Booking (Seller)

**Endpoint:** `PUT http://localhost:3000/api/vehicle-bookings/BOOKING_ID/accept`

**Headers:**
```
Authorization: Bearer SELLER_TOKEN
```

**Body:**
```json
{}
```

**Expected Response (200):**
```json
{
  "success": true,
  "message": "Booking confirmed successfully",
  "data": {
    "booking": {
      "status": "CONFIRMED",
      "agreedPrice": 4800,
      "confirmedAt": "2024-01-15T10:15:00Z"
    }
  }
}
```

---

### 5. Get Conversation

**Endpoint:** `GET http://localhost:3000/api/messages/booking/BOOKING_ID`

**Headers:**
```
Authorization: Bearer BUYER_TOKEN
```

**Expected Response (200):**
```json
{
  "success": true,
  "data": {
    "messages": [
      {
        "id": "MSG_ID_1",
        "messageType": "TEXT",
        "content": "Hi! Interested in this truck",
        "status": "READ"
      },
      {
        "id": "MSG_ID_2",
        "messageType": "PRICE_PROPOSAL",
        "content": "Can you do 4800/km?",
        "proposedPrice": 4800,
        "status": "READ"
      }
    ],
    "pagination": {
      "page": 1,
      "total": 2
    }
  }
}
```

---

### 6. Test Privacy: Third Party Cannot Access

**Endpoint:** `GET http://localhost:3000/api/messages/booking/BOOKING_ID`

**Headers:**
```
Authorization: Bearer THIRD_PARTY_TOKEN
```

**Expected Response (403):**
```json
{
  "success": false,
  "message": "You do not have access to this booking"
}
```

✅ **Privacy enforced!** Third party gets 403 Forbidden

---

## 🔌 Socket.IO Real-time Testing

### Connect Socket.IO Client

```javascript
const io = require('socket.io-client');

// Connect with JWT token
const socket = io('http://localhost:3000', {
  auth: {
    token: 'YOUR_ACCESS_TOKEN'
  }
});

// Listen for booking events
socket.on('booking:requested', (data) => {
  console.log('📩 New booking request:', data.booking.id);
});

socket.on('booking:price-proposed', (data) => {
  console.log('💰 Price proposed:', data.booking.lastPriceProposal.proposedPrice);
});

socket.on('booking:confirmed', (data) => {
  console.log('✅ Booking confirmed!', data.booking.agreedPrice);
});

socket.on('message:new', (data) => {
  console.log('💬 New message:', data.message.content);
});
```

---

## 📊 Postman Collection (Pre-built)

Download from: `POSTMAN_COLLECTIONS/Phase1-BookingSystem.json`

Or import this curl command:
```bash
curl --location --request POST 'http://localhost:3000/api/vehicle-bookings' \
  --header 'Authorization: Bearer YOUR_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{
    "postId": "POST_ID",
    "assignmentId": "ASSIGNMENT_ID"
  }'
```

---

## 🧪 Run Automated Tests

### Run All Phase 1 Tests

```bash
npm test -- tests/phase1.booking.test.js
```

### Run Specific Test Suite

```bash
npm test -- tests/phase1.booking.test.js --testNamePattern="Create Booking"
```

### Run with Coverage

```bash
npm test -- tests/phase1.booking.test.js --coverage
```

### Expected Test Output

```
✓ POST /api/vehicle-bookings - Create Booking (5 tests)
  ✓ should create booking request successfully
  ✓ should prevent buyer from booking own vehicle
  ✓ should require postId and assignmentId
  ✓ should prevent duplicate bookings
  ✓ should validate post is active

✓ GET /api/vehicle-bookings/:id - Get Booking (3 tests)
  ✓ should retrieve booking with full details
  ✓ should prevent third party from viewing
  ✓ should auto-mark messages as read

... (47 more tests)

Tests: 50 passed, 50 total
```

---

## 🔍 Verification Checklist

### API Functionality
- [ ] Create booking successfully
- [ ] View booking as buyer/seller
- [ ] View booking denied to third party (403)
- [ ] Propose price (starts negotiation)
- [ ] Accept booking (finalizes price)
- [ ] Reject booking (cancels)
- [ ] Cancel booking (buyer only)
- [ ] Get all my bookings
- [ ] Get booking stats

### Messaging Functionality
- [ ] Send message in booking
- [ ] Third party blocked from sending (403)
- [ ] View conversation as participant
- [ ] Third party blocked from viewing (403)
- [ ] Auto-mark messages as read
- [ ] Get unread count
- [ ] Delete message (within 5 min)
- [ ] Search messages

### Real-time (Socket.IO)
- [ ] Receive booking:requested event
- [ ] Receive booking:price-proposed event
- [ ] Receive booking:confirmed event
- [ ] Receive message:new event
- [ ] Receive message:read event

### Privacy & Security
- [ ] Third party cannot view booking
- [ ] Third party cannot view messages
- [ ] Third party cannot propose price
- [ ] Audit trail logs all actions
- [ ] Error messages don't leak data

### Data Integrity
- [ ] Booking references correct post/assignment
- [ ] Message linked to correct booking
- [ ] Prices tracked correctly
- [ ] Status transitions valid
- [ ] Timestamps accurate

---

## 🐛 Common Issues & Fixes

### "Booking not found" Error
**Cause:** PostId or AssignmentId invalid
**Fix:** Ensure IDs are from actual VehicleRouteAvailability and VehicleRouteAssignment documents

### "Only the vehicle seller can accept"
**Cause:** Using buyer token to accept
**Fix:** Use seller token (the one who posted the vehicle)

### "You do not have access to this booking"
**Cause:** Using third party token
**Fix:** Use buyer or seller token from the booking

### Socket.IO not connecting
**Cause:** Invalid JWT token
**Fix:** Ensure valid access token passed in auth header

### Messages not appearing
**Cause:** Different booking context
**Fix:** Verify both using same bookingId

---

## 📈 Performance Tips

### For Large Datasets
- Use pagination: `?page=1&limit=50`
- Filter by status: `?status=CONFIRMED`
- Sort efficiently via indexes

### Database Queries Optimized
- All key fields indexed
- Lean queries for list operations
- Populate only needed fields

### Real-time Optimization
- Socket.IO rooms scoped by transporter ID
- Events only sent to participants
- No broadcast to all users

---

## 📚 Documentation Files

| File | Purpose |
|------|---------|
| [PHASE1_API_DOCUMENTATION.md](PHASE1_API_DOCUMENTATION.md) | Complete API reference |
| [PHASE1_COMPLETE_SUMMARY.md](PHASE1_COMPLETE_SUMMARY.md) | Implementation summary |
| [IMPLEMENTATION_PLAN_2PHASES.md](IMPLEMENTATION_PLAN_2PHASES.md) | Overall 2-phase plan |

---

## ✅ Phase 1 Testing Workflow

```
1. Start Server
   └─→ npm install && node index.js

2. Create Booking
   └─→ POST /api/vehicle-bookings
       └─→ Get booking ID

3. Send Message
   └─→ POST /api/messages
       └─→ Verify delivered

4. Propose Price
   └─→ PUT .../propose-price
       └─→ Status = NEGOTIATING

5. Accept Booking
   └─→ PUT .../accept
       └─→ Status = CONFIRMED

6. Verify Privacy
   └─→ Try with third party token
       └─→ Get 403 Forbidden ✅

7. Run Tests
   └─→ npm test -- tests/phase1.booking.test.js
       └─→ All 50+ tests pass ✅
```

---

## 🚀 Ready to Deploy?

### Pre-deployment Checklist
- [ ] All 50+ tests passing
- [ ] Privacy tests verified
- [ ] Socket.IO events working
- [ ] Database indexes created
- [ ] Error handling tested
- [ ] Load testing done
- [ ] Security audit passed

### Deployment Command
```bash
npm run build
npm start
```

---

## 📞 Support & Questions

**For issues or questions:**
1. Check error message and HTTP status code
2. Verify database connectivity
3. Review test cases for examples
4. Check Socket.IO server logs

---

## 🎉 Phase 1 Status

✅ **100% Complete & Ready for Testing**

```
Models:        ✅ 3/3
Controllers:   ✅ 2/2
Routes:        ✅ 2/2
Middleware:    ✅ 1/1
Socket Events: ✅ 7/7
Documentation: ✅ Complete
Tests:         ✅ 50+
```

**Next: Phase 2 - Trip Integration & Notifications**

