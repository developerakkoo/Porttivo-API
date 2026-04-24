const request = require('supertest');
const mongoose = require('mongoose');
const VehicleBooking = require('../src/models/VehicleBooking');
const TransporterMessage = require('../src/models/TransporterMessage');
const VehicleRouteAvailability = require('../src/models/VehicleRouteAvailability');
const VehicleRouteAssignment = require('../src/models/VehicleRouteAssignment');
const Transporter = require('../src/models/Transporter');
const Vehicle = require('../src/models/Vehicle');

// Mock setup
let app;
let buyerId = new mongoose.Types.ObjectId();
let sellerId = new mongoose.Types.ObjectId();
let vehicleId = new mongoose.Types.ObjectId();
let postId;
let assignmentId;
let bookingId;

describe('Phase 1: Vehicle Booking System', () => {
  
  describe('POST /api/vehicle-bookings - Create Booking', () => {
    
    it('should create booking request successfully', async () => {
      // Setup: Create post, assignment, and vehicles
      const buyerToken = 'mock-buyer-token';
      const sellerToken = 'mock-seller-token';

      const post = await VehicleRouteAvailability.create({
        transporterId: sellerId,
        vehicleType: 'Truck',
        origin: 'Pune',
        destination: 'Mumbai',
        quantity: 2,
        slotsLeft: 1,
        availableFrom: new Date(),
        availableTo: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        pricePerVehicle: 5000,
        status: 'active',
      });
      postId = post._id;

      const assignment = await VehicleRouteAssignment.create({
        postId: post._id,
        vehicleId,
        transporterId: sellerId,
        price: 5000,
      });
      assignmentId = assignment._id;

      // Test: Create booking
      const res = await request(app)
        .post('/api/vehicle-bookings')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          postId: post._id.toString(),
          assignmentId: assignment._id.toString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.status).toBe('REQUESTED');
      expect(res.body.data.booking.estimatedPrice).toBe(5000);
      
      bookingId = res.body.data.booking.id;
    });

    it('should prevent buyer from booking own vehicle', async () => {
      const res = await request(app)
        .post('/api/vehicle-bookings')
        .set('Authorization', `Bearer mock-token`)
        .send({
          postId: postId.toString(),
          assignmentId: assignmentId.toString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('cannot book your own vehicle');
    });

    it('should require postId and assignmentId', async () => {
      const res = await request(app)
        .post('/api/vehicle-bookings')
        .set('Authorization', `Bearer mock-token`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/vehicle-bookings/:id - Get Booking', () => {
    
    it('should retrieve booking with full details', async () => {
      const res = await request(app)
        .get(`/api/vehicle-bookings/${bookingId}`)
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.id).toBe(bookingId);
      expect(res.body.data.messages).toBeDefined();
    });

    it('should prevent third party from viewing booking', async () => {
      const thirdPartyId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .get(`/api/vehicle-bookings/${bookingId}`)
        .set('Authorization', `Bearer mock-third-party-token`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('do not have access');
    });
  });

  describe('GET /api/vehicle-bookings/my-bookings - Get My Bookings', () => {
    
    it('should retrieve all bookings for authenticated user', async () => {
      const res = await request(app)
        .get('/api/vehicle-bookings/my-bookings')
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.bookings)).toBe(true);
    });

    it('should filter bookings by role (buyer)', async () => {
      const res = await request(app)
        .get('/api/vehicle-bookings/my-bookings?role=buyer')
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.data.bookings.every(b => b.buyerId._id.toString() === buyerId.toString())).toBe(true);
    });

    it('should filter bookings by status', async () => {
      const res = await request(app)
        .get('/api/vehicle-bookings/my-bookings?status=REQUESTED')
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.data.bookings.every(b => b.status === 'REQUESTED')).toBe(true);
    });
  });

  describe('PUT /api/vehicle-bookings/:id/propose-price - Propose Price', () => {
    
    it('should allow buyer to propose price', async () => {
      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/propose-price`)
        .set('Authorization', `Bearer mock-buyer-token`)
        .send({
          proposedPrice: 4800,
          message: 'Can you do 4800/km?',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.status).toBe('NEGOTIATING');
      expect(res.body.data.booking.lastPriceProposal.proposedPrice).toBe(4800);
      expect(res.body.data.booking.negotiationRound).toBe(1);
    });

    it('should allow seller to counter-propose', async () => {
      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/propose-price`)
        .set('Authorization', `Bearer mock-seller-token`)
        .send({
          proposedPrice: 4900,
          message: 'How about 4900?',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.booking.lastPriceProposal.proposedPrice).toBe(4900);
      expect(res.body.data.booking.negotiationRound).toBe(2);
    });

    it('should require valid proposedPrice', async () => {
      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/propose-price`)
        .set('Authorization', `Bearer mock-buyer-token`)
        .send({
          proposedPrice: -100,
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should not allow price proposal on CONFIRMED booking', async () => {
      // First confirm the booking
      const booking = await VehicleBooking.findByIdAndUpdate(
        bookingId,
        { status: 'CONFIRMED', agreedPrice: 4900 },
        { new: true }
      );

      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/propose-price`)
        .set('Authorization', `Bearer mock-buyer-token`)
        .send({
          proposedPrice: 4700,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot propose price');
    });
  });

  describe('PUT /api/vehicle-bookings/:id/accept - Accept Booking', () => {
    
    it('should allow seller to accept booking with negotiated price', async () => {
      // Reset booking to NEGOTIATING state
      const booking = await VehicleBooking.findByIdAndUpdate(
        bookingId,
        {
          status: 'NEGOTIATING',
          lastPriceProposal: {
            proposedBy: buyerId,
            proposedPrice: 4800,
            proposedAt: new Date(),
          },
        },
        { new: true }
      );

      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer mock-seller-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.status).toBe('CONFIRMED');
      expect(res.body.data.booking.agreedPrice).toBe(4800);
      expect(res.body.data.booking.confirmedAt).toBeDefined();
    });

    it('should prevent buyer from accepting', async () => {
      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Only the vehicle seller');
    });

    it('should not allow accept on CANCELLED booking', async () => {
      const booking = await VehicleBooking.findByIdAndUpdate(
        bookingId,
        { status: 'CANCELLED' },
        { new: true }
      );

      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/accept`)
        .set('Authorization', `Bearer mock-seller-token`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot accept booking');
    });
  });

  describe('PUT /api/vehicle-bookings/:id/reject - Reject Booking', () => {
    
    it('should allow seller to reject booking', async () => {
      // Create new booking for testing
      const newBooking = await VehicleBooking.create({
        postId,
        assignmentId,
        vehicleId,
        buyerId,
        sellerId,
        estimatedPrice: 5000,
        status: 'REQUESTED',
      });

      const res = await request(app)
        .put(`/api/vehicle-bookings/${newBooking._id}/reject`)
        .set('Authorization', `Bearer mock-seller-token`)
        .send({
          reason: 'Vehicle already booked',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.status).toBe('REJECTED');
      expect(res.body.data.booking.rejectReason).toBe('Vehicle already booked');
    });

    it('should prevent buyer from rejecting', async () => {
      const res = await request(app)
        .put(`/api/vehicle-bookings/${bookingId}/reject`)
        .set('Authorization', `Bearer mock-buyer-token`)
        .send({
          reason: 'Not interested',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/vehicle-bookings/:id - Cancel Booking', () => {
    
    it('should allow buyer to cancel REQUESTED booking', async () => {
      const newBooking = await VehicleBooking.create({
        postId,
        assignmentId,
        vehicleId,
        buyerId,
        sellerId,
        estimatedPrice: 5000,
        status: 'REQUESTED',
      });

      const res = await request(app)
        .delete(`/api/vehicle-bookings/${newBooking._id}`)
        .set('Authorization', `Bearer mock-buyer-token`)
        .send({
          reason: 'Found another vehicle',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.booking.status).toBe('CANCELLED');
    });

    it('should prevent seller from cancelling', async () => {
      const res = await request(app)
        .delete(`/api/vehicle-bookings/${bookingId}`)
        .set('Authorization', `Bearer mock-seller-token`);

      expect(res.status).toBe(403);
    });

    it('should prevent cancellation of CONFIRMED booking', async () => {
      const booking = await VehicleBooking.findByIdAndUpdate(
        bookingId,
        { status: 'CONFIRMED' },
        { new: true }
      );

      const res = await request(app)
        .delete(`/api/vehicle-bookings/${bookingId}`)
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/vehicle-bookings/stats - Get Stats', () => {
    
    it('should return booking statistics', async () => {
      const res = await request(app)
        .get('/api/vehicle-bookings/stats')
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.stats).toHaveProperty('totalAsNeeded');
      expect(res.body.data.stats).toHaveProperty('successRate');
    });
  });

  // MESSAGE TESTS
  describe('POST /api/messages - Send Message', () => {
    
    it('should send message in booking conversation', async () => {
      const booking = await VehicleBooking.findByIdAndUpdate(
        bookingId,
        { status: 'REQUESTED' },
        { new: true }
      );

      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer mock-buyer-token`)
        .send({
          bookingId: booking._id.toString(),
          content: 'Interested in this vehicle',
          messageType: 'TEXT',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message.content).toBe('Interested in this vehicle');
      expect(res.body.data.message.status).toBe('DELIVERED');
    });

    it('should prevent third party from sending message', async () => {
      const thirdPartyId = new mongoose.Types.ObjectId();

      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer mock-third-party-token`)
        .send({
          bookingId: bookingId.toString(),
          content: 'Hi there',
          messageType: 'TEXT',
        });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('do not have access');
    });

    it('should require content', async () => {
      const res = await request(app)
        .post('/api/messages')
        .set('Authorization', `Bearer mock-buyer-token`)
        .send({
          bookingId: bookingId.toString(),
          content: '',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/messages/booking/:bookingId - Get Conversation', () => {
    
    it('should retrieve all messages for booking', async () => {
      const res = await request(app)
        .get(`/api/messages/booking/${bookingId}`)
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.messages)).toBe(true);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should prevent third party from viewing conversation', async () => {
      const res = await request(app)
        .get(`/api/messages/booking/${bookingId}`)
        .set('Authorization', `Bearer mock-third-party-token`);

      expect(res.status).toBe(403);
    });

    it('should auto-mark unread messages as read', async () => {
      const res = await request(app)
        .get(`/api/messages/booking/${bookingId}`)
        .set('Authorization', `Bearer mock-seller-token`);

      expect(res.status).toBe(200);

      // Verify messages are marked as read
      const messages = await TransporterMessage.find({
        bookingId,
        receiverId: sellerId,
      });

      expect(messages.every(m => m.status === 'READ')).toBe(true);
    });
  });

  describe('PUT /api/messages/:messageId/read - Mark as Read', () => {
    
    it('should mark message as read', async () => {
      // Create unread message
      const message = await TransporterMessage.create({
        bookingId,
        senderId: sellerId,
        receiverId: buyerId,
        messageType: 'TEXT',
        content: 'Test message',
        status: 'DELIVERED',
      });

      const res = await request(app)
        .put(`/api/messages/${message._id}/read`)
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.data.message.status).toBe('READ');
      expect(res.body.data.message.readAt).toBeDefined();
    });

    it('should prevent sender from marking as read', async () => {
      const message = await TransporterMessage.findOne({
        bookingId,
        senderId: sellerId,
      });

      const res = await request(app)
        .put(`/api/messages/${message._id}/read`)
        .set('Authorization', `Bearer mock-seller-token`);

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/messages/unread-count - Get Unread Count', () => {
    
    it('should return unread message count', async () => {
      const res = await request(app)
        .get('/api/messages/unread-count')
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('totalUnread');
      expect(res.body.data).toHaveProperty('byBooking');
    });
  });

  describe('DELETE /api/messages/:messageId - Delete Message', () => {
    
    it('should allow sender to delete within 5 minutes', async () => {
      const message = await TransporterMessage.create({
        bookingId,
        senderId: buyerId,
        receiverId: sellerId,
        messageType: 'TEXT',
        content: 'Test message',
        status: 'DELIVERED',
      });

      const res = await request(app)
        .delete(`/api/messages/${message._id}`)
        .set('Authorization', `Bearer mock-buyer-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should prevent receiver from deleting message', async () => {
      const message = await TransporterMessage.findOne({
        bookingId,
        senderId: buyerId,
      });

      const res = await request(app)
        .delete(`/api/messages/${message._id}`)
        .set('Authorization', `Bearer mock-seller-token`);

      expect(res.status).toBe(403);
    });
  });

  describe('Privacy & Security Tests', () => {
    
    it('should enforce privacy: C cannot see A-B booking', async () => {
      const thirdPartyToken = 'mock-third-party-token';

      // Try to view booking
      const bookingRes = await request(app)
        .get(`/api/vehicle-bookings/${bookingId}`)
        .set('Authorization', thirdPartyToken);

      expect(bookingRes.status).toBe(403);

      // Try to send message
      const messageRes = await request(app)
        .post('/api/messages')
        .set('Authorization', thirdPartyToken)
        .send({
          bookingId: bookingId.toString(),
          content: 'Hi',
        });

      expect(messageRes.status).toBe(403);

      // Try to view conversation
      const convRes = await request(app)
        .get(`/api/messages/booking/${bookingId}`)
        .set('Authorization', thirdPartyToken);

      expect(convRes.status).toBe(403);
    });

    it('should maintain audit trail for all actions', async () => {
      const auditLogs = await VehicleBookingAudit.find({ bookingId });
      
      expect(auditLogs.length).toBeGreaterThan(0);
      expect(auditLogs[0]).toHaveProperty('action');
      expect(auditLogs[0]).toHaveProperty('performedBy');
      expect(auditLogs[0]).toHaveProperty('createdAt');
    });
  });

  describe('Complete Workflow Test', () => {
    
    it('should execute full booking flow: Request -> Negotiate -> Confirm', async () => {
      // Create booking
      const booking = await VehicleBooking.create({
        postId,
        assignmentId,
        vehicleId,
        buyerId,
        sellerId,
        estimatedPrice: 5000,
        status: 'REQUESTED',
      });

      expect(booking.status).toBe('REQUESTED');

      // B proposes price
      booking.lastPriceProposal = {
        proposedBy: buyerId,
        proposedPrice: 4800,
        proposedAt: new Date(),
      };
      booking.status = 'NEGOTIATING';
      booking.negotiationRound = 1;
      await booking.save();

      expect(booking.status).toBe('NEGOTIATING');

      // A counter-proposes
      booking.lastPriceProposal = {
        proposedBy: sellerId,
        proposedPrice: 4900,
        proposedAt: new Date(),
      };
      booking.negotiationRound = 2;
      await booking.save();

      // A accepts
      booking.agreedPrice = 4900;
      booking.status = 'CONFIRMED';
      booking.confirmedAt = new Date();
      await booking.save();

      const finalBooking = await VehicleBooking.findById(booking._id);
      expect(finalBooking.status).toBe('CONFIRMED');
      expect(finalBooking.agreedPrice).toBe(4900);
      expect(finalBooking.negotiationRound).toBe(2);
    });
  });
});
