# Vehicle Booking Workflow - Quick Reference Card

## ⚡ Quick Start (60 Seconds)

**The Workflow:**
1. Vehicle Owner posts availability (POST /api/vehicle-posts)
2. Transporter searches for posts (GET /api/vehicle-posts)
3. Create booking request (POST /api/vehicle-bookings)
4. Both parties chat and negotiate (POST /api/messages)
5. Owner accepts booking (PUT /api/vehicle-bookings/:id/accept)
6. Trip created and started (POST /api/trips, PUT /api/trips/:id/start)

**Status:** ✅ Production Ready

---

## 📱 Key API Endpoints

### Posts
```
POST   /api/vehicle-posts              Create post
GET    /api/vehicle-posts              Search posts
GET    /api/vehicle-posts/:id          View post details
```

### Bookings
```
POST   /api/vehicle-bookings           Create booking request
GET    /api/vehicle-bookings/:id       View booking
PUT    /api/vehicle-bookings/:id/propose-price   Propose price
PUT    /api/vehicle-bookings/:id/accept           Accept booking
PUT    /api/vehicle-bookings/:id/reject           Reject booking
```

### Messaging
```
POST   /api/messages                   Send message
GET    /api/messages/booking/:id       Get conversation
```

### Trips
```
POST   /api/trips                      Create trip
PUT    /api/trips/:id/start            Start trip
```

---

## 🔄 Booking Status Flow

```
REQUESTED → NEGOTIATING → CONFIRMED → COMPLETED

Alt flows:
REQUESTED → REJECTED (seller)
REQUESTED/NEGOTIATING → CANCELLED (buyer)
```

---

## 💬 Message Types

| Type | Use Case |
|------|----------|
| TEXT | Regular conversation |
| PRICE_PROPOSAL | Initial price offer |
| PRICE_COUNTER | Counter-offer |
| ACCEPTED | Agreement |
| REJECTED | Rejection |

---

## 🗄️ Main Collections

| Collection | Purpose |
|-----------|---------|
| VehicleRouteAvailability | Posts |
| VehicleBooking | Bookings |
| TransporterMessage | Messages |
| VehicleBookingAudit | Audit trail |

---

## 📊 Response Format

**Success:**
```json
{
  "success": true,
  "message": "Operation completed",
  "data": { /* response */ }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Error description",
  "error": { "code": "ERROR_CODE" }
}
```

---

## 🚨 Common Error Codes

| Code | Meaning | Fix |
|------|---------|-----|
| 400 | Bad request | Check request body |
| 401 | Unauthorized | Login again |
| 403 | Forbidden | Check permissions |
| 404 | Not found | Verify IDs |

---

## 🔌 WebSocket Events

```javascript
'vehiclePost:created'      // New post
'booking:requested'        // Booking created
'booking:price-proposed'   // Price offered
'booking:confirmed'        // Booking accepted
'message:new'              // New message
'trip:started'             // Trip started
```

---

## 📋 Complete Request Examples

### 1. Create Post
```bash
POST /api/vehicle-posts
Authorization: Bearer TOKEN

{
  "vehicleId": "id",
  "vehicleType": "TANKER",
  "origin": "Mumbai",
  "destination": "Delhi",
  "availableFrom": "2024-05-01T00:00:00Z",
  "availableTo": "2024-05-15T23:59:59Z",
  "quantity": 1,
  "pricePerVehicle": 50000
}
```

### 2. Search Posts
```bash
GET /api/vehicle-posts?origin=Mumbai&destination=Delhi&vehicleType=TANKER
Authorization: Bearer TOKEN
```

### 3. Create Booking
```bash
POST /api/vehicle-bookings
Authorization: Bearer TOKEN

{
  "postId": "post_id",
  "assignmentId": "assignment_id"
}
```

### 4. Send Message
```bash
POST /api/messages
Authorization: Bearer TOKEN

{
  "bookingId": "booking_id",
  "content": "Can you do 48000?",
  "messageType": "PRICE_PROPOSAL",
  "proposedPrice": 48000
}
```

### 5. Accept Booking
```bash
PUT /api/vehicle-bookings/:id/accept
Authorization: Bearer TOKEN

{
  "agreedPrice": 49000,
  "message": "Accepted!"
}
```

### 6. Create Trip
```bash
POST /api/trips
Authorization: Bearer TOKEN

{
  "vehicleId": "vehicle_id",
  "driverId": "driver_id",
  "bookingId": "booking_id",
  "origin": "Mumbai",
  "destination": "Delhi"
}
```

### 7. Start Trip
```bash
PUT /api/trips/:id/start
Authorization: Bearer TOKEN

{
  "startLocation": {
    "latitude": 19.0760,
    "longitude": 72.8777
  }
}
```

---

## ✅ Testing Checklist

- [ ] Create vehicle post
- [ ] Search and find post
- [ ] Create booking request
- [ ] Send messages
- [ ] Propose price
- [ ] Accept booking
- [ ] Create trip
- [ ] Start trip
- [ ] Monitor WebSocket events

---

## 📚 Full Documentation Files

1. **DOCUMENTATION_INDEX.md** - Navigation guide (START HERE)
2. **IMPLEMENTATION_SUMMARY.md** - Executive overview
3. **VEHICLE_BOOKING_WORKFLOW.md** - Complete API guide
4. **WORKFLOW_DIAGRAMS.md** - Visual representations
5. **DATABASE_SCHEMA_REFERENCE.md** - Data structure
6. **POSTMAN_VEHICLE_BOOKING_GUIDE.md** - Testing guide
7. **WORKFLOW_ENHANCEMENTS.md** - Future roadmap

---

## 🎯 Next Steps

1. Read **DOCUMENTATION_INDEX.md** for navigation
2. Study **VEHICLE_BOOKING_WORKFLOW.md** for details
3. Use **POSTMAN_VEHICLE_BOOKING_GUIDE.md** for testing
4. Reference **WORKFLOW_DIAGRAMS.md** for visual understanding
5. Implement enhancements from **WORKFLOW_ENHANCEMENTS.md**

---

## 📞 Support

- API Questions → VEHICLE_BOOKING_WORKFLOW.md
- Database Questions → DATABASE_SCHEMA_REFERENCE.md
- Testing Questions → POSTMAN_VEHICLE_BOOKING_GUIDE.md
- Visual Understanding → WORKFLOW_DIAGRAMS.md

---

**Status: ✅ Production Ready**  
**Last Updated: April 24, 2024**
