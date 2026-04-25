const VehicleBooking = require('../models/VehicleBooking')
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability')
const VehicleRouteAssignment = require('../models/VehicleRouteAssignment')
const TransporterMessage = require('../models/TransporterMessage')
// const VehicleBookingAudit = require('../models/VehicleBookingAudit');
const Vehicle = require('../models/Vehicle')
const Transporter = require('../models/Transporter')
const { getIO } = require('../services/socket.service')
const {
  VehicleBookingAudit,
  BOOKING_AUDIT_ACTIONS
} = require('../models/VehicleBookingAudit')

/**
 * Create a booking request
 * POST /api/vehicle-bookings
 */
const createBooking = async (req, res, next) => {
  try {
    const buyerId = req.user?.id
    if (!buyerId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporters can create bookings'
      })
    }

    const { postId, assignmentId } = req.body

    if (!postId || !assignmentId) {
      return res.status(400).json({
        success: false,
        message: 'postId and assignmentId are required'
      })
    }

    // Get post details
    const post = await VehicleRouteAvailability.findById(postId).populate(
      'transporterId',
      'name mobile company'
    )
    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' })
    }

    if (post.status !== 'active') {
      return res
        .status(400)
        .json({ success: false, message: 'Post is not active' })
    }

    // Get assignment (vehicle) details
    const assignment = await VehicleRouteAssignment.findById(
      assignmentId
    ).populate('vehicleId', 'vehicleNumber vehicleType trailerType')
    if (!assignment) {
      return res
        .status(404)
        .json({ success: false, message: 'Vehicle assignment not found' })
    }

    if (assignment.postId.toString() !== postId) {
      return res.status(400).json({
        success: false,
        message: 'Assignment does not belong to this post'
      })
    }

    const sellerId = assignment.transporterId

    // Buyer cannot book their own vehicle
    if (buyerId.toString() === sellerId.toString()) {
      return res
        .status(400)
        .json({ success: false, message: 'You cannot book your own vehicle' })
    }

    // Check if buyer already has a pending/confirmed booking for this post
    const existingBooking = await VehicleBooking.findOne({
      postId,
      buyerId,
      status: { $in: ['REQUESTED', 'NEGOTIATING', 'CONFIRMED'] }
    })

    if (existingBooking) {
      return res.status(400).json({
        success: false,
        message: 'You already have an active booking for this post'
      })
    }

    // Create booking in DRAFT status (inquiry mode - not yet submitted to seller)
    const booking = await VehicleBooking.create({
      postId,
      assignmentId,
      vehicleId: assignment.vehicleId,
      buyerId,
      sellerId,
      estimatedPrice: assignment.price,
      status: 'DRAFT'
    })

    // Create audit log
    await VehicleBookingAudit.logAction({
      bookingId: booking._id,
      action: BOOKING_AUDIT_ACTIONS.INQUIRY_CREATED,
      performedBy: buyerId,
      details: {
        postId,
        assignmentId,
        estimatedPrice: assignment.price
      },
      notes: 'Booking created in DRAFT (inquiry mode)'
    })

    // Populate for response
    const populatedBooking = await VehicleBooking.findById(booking._id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .lean()

    // NOTE: NO socket event to seller yet - booking is in DRAFT status
    // Socket event will be sent only when booking is formally submitted (REQUESTED status)

    return res.status(201).json({
      success: true,
      message:
        'Booking inquiry created. Please negotiate price before submitting booking request.',
      data: {
        booking: populatedBooking,
        nextStep:
          'Use POST /api/messages to send price inquiry, then PUT /api/vehicle-bookings/:id/submit to formalize booking request after negotiation'
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get single booking by ID
 * GET /api/vehicle-bookings/:id
 */
const getBooking = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user?.id

    const booking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .populate('postId', 'origin destination availableFrom availableTo')
      .lean()

    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' })
    }

    // Check access: only buyer or seller can view
    const isBuyer = booking.buyerId._id.toString() === userId
    const isSeller = booking.sellerId._id.toString() === userId

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this booking'
      })
    }

    // Get all messages for this booking
    const messages = await TransporterMessage.find({ bookingId: id })
      .populate('senderId', 'name mobile')
      .sort({ createdAt: 1 })
      .lean()

    // Mark unread messages as read for the current user
    await TransporterMessage.updateMany(
      {
        bookingId: id,
        receiverId: userId,
        status: { $ne: 'READ' }
      },
      {
        status: 'READ',
        readAt: new Date()
      }
    )

    return res.status(200).json({
      success: true,
      data: {
        booking,
        messages,
        unreadCount: messages.filter(
          m => m.receiverId.toString() === userId && m.status !== 'READ'
        ).length
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get my bookings (as buyer or seller)
 * GET /api/vehicle-bookings/my-bookings
 */
const getMyBookings = async (req, res, next) => {
  try {
    const userId = req.user?.id
    const { status, role } = req.query // role: 'buyer' or 'seller'

    const query = {}

    // Filter by role
    if (role === 'buyer') {
      query.buyerId = userId
    } else if (role === 'seller') {
      query.sellerId = userId
    } else {
      // Both roles
      query.$or = [{ buyerId: userId }, { sellerId: userId }]
    }

    // Filter by status if provided
    if (status) {
      query.status = status
    }

    const bookings = await VehicleBooking.find(query)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType')
      .sort({ createdAt: -1 })
      .lean()

    // Get unread message counts
    const bookingIds = bookings.map(b => b._id)
    const unreadCounts = await TransporterMessage.aggregate([
      {
        $match: {
          bookingId: { $in: bookingIds },
          receiverId: mongoose.Types.ObjectId(userId),
          status: { $ne: 'READ' }
        }
      },
      {
        $group: {
          _id: '$bookingId',
          count: { $sum: 1 }
        }
      }
    ])

    const unreadMap = unreadCounts.reduce((acc, item) => {
      acc[item._id.toString()] = item.count
      return acc
    }, {})

    const results = bookings.map(b => ({
      ...b,
      unreadMessageCount: unreadMap[b._id.toString()] || 0
    }))

    return res.status(200).json({
      success: true,
      message: 'Bookings retrieved successfully',
      data: {
        bookings: results,
        total: results.length
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Propose price offer (optional negotiation)
 * PUT /api/vehicle-bookings/:id/propose-price
 */
const proposePriceOffer = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user?.id
    const { proposedPrice, message: messageText } = req.body

    if (!proposedPrice || proposedPrice <= 0) {
      return res
        .status(400)
        .json({ success: false, message: 'Valid proposedPrice is required' })
    }

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' })
    }

    // Only buyer or seller can propose
    const isBuyer = booking.buyerId.toString() === userId
    const isSeller = booking.sellerId.toString() === userId

    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this booking'
      })
    }

    // Can propose if DRAFT (buyer proposes initial price), REQUESTED (after submission), or NEGOTIATING
    if (!['DRAFT', 'REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot propose price for booking in ${booking.status} status`
      })
    }

    // Update booking
    booking.lastPriceProposal = {
      proposedBy: userId,
      proposedPrice,
      proposedAt: new Date()
    }
    booking.negotiationRound = (booking.negotiationRound || 0) + 1
    booking.status = 'NEGOTIATING'

    await booking.save()

    // Create message for price proposal
    const msgContent = messageText || `Proposed price: ₹${proposedPrice}`
    const message = await TransporterMessage.create({
      bookingId: id,
      senderId: userId,
      receiverId: isBuyer ? booking.sellerId : booking.buyerId,
      messageType: 'PRICE_PROPOSAL',
      content: msgContent,
      proposedPrice
    })

    // Create audit log
    await VehicleBookingAudit.logAction({
      bookingId: id,
      action: BOOKING_AUDIT_ACTIONS.PRICE_PROPOSED,
      performedBy: userId,
      details: {
        proposedPrice,
        negotiationRound: booking.negotiationRound
      }
    })

    // Populate for response
    const populatedBooking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType')
      .lean()

    // Emit socket event
    try {
      const io = getIO()
      const recipientId = isBuyer ? booking.sellerId : booking.buyerId
      io.to(`transporter:${recipientId}`).emit('booking:price-proposed', {
        booking: populatedBooking,
        message: message.toObject ? message.toObject() : message
      })
    } catch (err) {
      console.warn(
        'Socket emit failed (booking:price-proposed):',
        err.message || err
      )
    }

    return res.status(200).json({
      success: true,
      message: 'Price proposal sent successfully',
      data: { booking: populatedBooking, message }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Accept booking and finalize price
 * PUT /api/vehicle-bookings/:id/accept
 */
const acceptBooking = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user?.id

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' })
    }

    // Only seller can accept/confirm booking
    if (booking.sellerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle seller can accept this booking'
      })
    }

    // Can only accept if REQUESTED or NEGOTIATING
    if (!['REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot accept booking in ${booking.status} status`
      })
    }

    // Set agreed price
    const finalPrice =
      booking.lastPriceProposal?.proposedPrice || booking.estimatedPrice
    booking.agreedPrice = finalPrice
    booking.status = 'CONFIRMED'
    booking.acceptedAt = new Date()
    booking.confirmedAt = new Date()

    await booking.save()

    // Create confirmation message
    const confirmMessage = await TransporterMessage.create({
      bookingId: id,
      senderId: userId,
      receiverId: booking.buyerId,
      messageType: 'ACCEPTED',
      content: `Booking accepted at ₹${finalPrice}`,
      proposedPrice: finalPrice
    })

    // Create audit log
    await VehicleBookingAudit.logAction({
      bookingId: id,
      action: BOOKING_AUDIT_ACTIONS.CONFIRMED,
      performedBy: userId,
      details: {
        agreedPrice: finalPrice
      }
    })

    // Populate for response
    const populatedBooking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType')
      .lean()

    // Emit socket events
    try {
      const io = getIO()
      io.to(`transporter:${booking.buyerId}`).emit('booking:confirmed', {
        booking: populatedBooking
      })
      io.to(`transporter:${booking.sellerId}`).emit('booking:confirmed', {
        booking: populatedBooking
      })
    } catch (err) {
      console.warn(
        'Socket emit failed (booking:confirmed):',
        err.message || err
      )
    }

    return res.status(200).json({
      success: true,
      message: 'Booking confirmed successfully',
      data: { booking: populatedBooking }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Reject booking
 * PUT /api/vehicle-bookings/:id/reject
 */
const rejectBooking = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user?.id
    const { reason } = req.body

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' })
    }

    // Only seller can reject
    if (booking.sellerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle seller can reject this booking'
      })
    }

    // Can only reject if REQUESTED or NEGOTIATING
    if (!['REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject booking in ${booking.status} status`
      })
    }

    booking.status = 'REJECTED'
    booking.rejectedAt = new Date()
    booking.rejectReason = reason || 'No reason provided'

    await booking.save()

    // Create rejection message
    const rejectionMessage = await TransporterMessage.create({
      bookingId: id,
      senderId: userId,
      receiverId: booking.buyerId,
      messageType: 'REJECTED',
      content: `Booking rejected. Reason: ${reason || 'No reason provided'}`
    })

    // Create audit log
    await VehicleBookingAudit.logAction({
      bookingId: id,
      action: BOOKING_AUDIT_ACTIONS.REJECTED,
      performedBy: userId,
      details: {
        reason: reason || 'No reason provided'
      }
    })

    // Populate for response
    const populatedBooking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .lean()

    // Emit socket event
    try {
      const io = getIO()
      io.to(`transporter:${booking.buyerId}`).emit('booking:rejected', {
        booking: populatedBooking
      })
    } catch (err) {
      console.warn('Socket emit failed (booking:rejected):', err.message || err)
    }

    return res.status(200).json({
      success: true,
      message: 'Booking rejected successfully',
      data: { booking: populatedBooking }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Cancel booking (by buyer before confirmation)
 * DELETE /api/vehicle-bookings/:id
 */
const cancelBooking = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user?.id
    const { reason } = req.body

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' })
    }

    // Only buyer can cancel before confirmation
    if (booking.buyerId.toString() !== userId) {
      return res
        .status(403)
        .json({ success: false, message: 'Only the booking buyer can cancel' })
    }

    // Can only cancel if DRAFT, REQUESTED or NEGOTIATING
    // DRAFT: buyer changed mind during inquiry
    // REQUESTED/NEGOTIATING: buyer changed mind after formal submission or during negotiation
    if (!['DRAFT', 'REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel booking in ${booking.status} status`
      })
    }

    const previousStatus = booking.status
    booking.status = 'CANCELLED'
    await booking.save()

    // Create audit log
    await VehicleBookingAudit.logAction({
      bookingId: id,
      action: BOOKING_AUDIT_ACTIONS.CANCELLED,
      performedBy: userId,
      details: {
        reason: reason || 'Cancelled by buyer',
        previousStatus
      }
    })

    // Populate for response
    const populatedBooking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .lean()

    // Only emit socket event to seller if booking was formally submitted (not DRAFT)
    // DRAFT bookings were never sent to seller, so no need to notify cancellation
    if (previousStatus !== 'DRAFT') {
      try {
        const io = getIO()
        io.to(`transporter:${booking.sellerId}`).emit('booking:cancelled', {
          booking: populatedBooking
        })
      } catch (err) {
        console.warn(
          'Socket emit failed (booking:cancelled):',
          err.message || err
        )
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Booking cancelled successfully',
      data: { booking: populatedBooking }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get booking stats for current user
 * GET /api/vehicle-bookings/stats
 */
const getBookingStats = async (req, res, next) => {
  try {
    const userId = req.user?.id

    const [
      totalAsNeeded,
      totalAsVendor,
      confirmedBookings,
      completedBookings,
      rejectedBookings
    ] = await Promise.all([
      VehicleBooking.countDocuments({ buyerId: userId }),
      VehicleBooking.countDocuments({ sellerId: userId }),
      VehicleBooking.countDocuments({ buyerId: userId, status: 'CONFIRMED' }),
      VehicleBooking.countDocuments({ buyerId: userId, status: 'COMPLETED' }),
      VehicleBooking.countDocuments({ buyerId: userId, status: 'REJECTED' })
    ])

    return res.status(200).json({
      success: true,
      data: {
        stats: {
          totalAsNeeded,
          totalAsVendor,
          confirmedBookings,
          completedBookings,
          rejectedBookings,
          successRate:
            totalAsNeeded > 0
              ? Math.round((confirmedBookings / totalAsNeeded) * 100)
              : 0
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Submit booking request (after price negotiation in DRAFT status)
 * PUT /api/vehicle-bookings/:id/submit
 * Only buyer can submit, only from DRAFT status
 */
const submitBooking = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = req.user?.id

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res
        .status(404)
        .json({ success: false, message: 'Booking not found' })
    }

    // Only buyer can submit
    if (booking.buyerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the buyer can submit this booking request'
      })
    }

    // Can only submit if DRAFT
    if (!['DRAFT', 'NEGOTIATING'].includes(booking.status)) {
  return res.status(400).json({
    success: false,
    message: `Cannot submit booking in ${booking.status} status`,
  });
}

    // Move from DRAFT to REQUESTED status
    booking.status = 'REQUESTED'
    booking.submittedAt = new Date()
    await booking.save()

    // Create audit log
    await VehicleBookingAudit.logAction({
      bookingId: id,
      action: BOOKING_AUDIT_ACTIONS.BOOKING_SUBMITTED,
      performedBy: userId,
      details: {
        previousStatus: 'DRAFT',
        newStatus: 'REQUESTED'
      },
      notes: 'Booking formally submitted to seller after price negotiation',
      source: 'API'
    })

    // Populate for response
    const populatedBooking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .lean()

    // NOW emit socket event to seller (booking is formally submitted)
    try {
      const io = getIO()
      io.to(`transporter:${booking.sellerId}`).emit('booking:requested', {
        booking: {
          id: populatedBooking._id,
          buyer: populatedBooking.buyerId,
          vehicle: populatedBooking.vehicleId,
          estimatedPrice: populatedBooking.estimatedPrice,
          submittedAt: booking.submittedAt,
          createdAt: populatedBooking.createdAt
        }
      })
    } catch (err) {
      console.warn(
        'Socket emit failed (booking:requested):',
        err.message || err
      )
    }

    return res.status(200).json({
      success: true,
      message: 'Booking request formally submitted to seller',
      data: { booking: populatedBooking }
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createBooking,
  getBooking,
  getMyBookings,
  proposePriceOffer,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  submitBooking,
  getBookingStats
}
