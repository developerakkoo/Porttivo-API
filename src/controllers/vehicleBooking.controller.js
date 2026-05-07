const mongoose = require('mongoose')
const Notification = require('../models/Notification')
const VehicleBooking = require('../models/VehicleBooking')
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability')
const VehicleRouteAssignment = require('../models/VehicleRouteAssignment')
const TransporterMessage = require('../models/TransporterMessage')
// const VehicleBookingAudit = require('../models/VehicleBookingAudit');
const Vehicle = require('../models/Vehicle')
const Transporter = require('../models/Transporter')
const { createTripFromBooking } = require('../services/bookingToTrip.service')
const { getIO } = require('../services/socket.service')
const {
  VehicleBookingAudit,
  BOOKING_AUDIT_ACTIONS
} = require('../models/VehicleBookingAudit')
const { getTransporterActorId } = require('../utils/transporterActor')
const { buildChatMessageSocketPayload } = require('../utils/marketplaceChatPayload')
const {
  buildMarketplaceMessageNotificationFields
} = require('../utils/marketplaceNotification')

function geoFieldToLabel(v) {
  if (v == null) return null
  if (typeof v === 'string') return v
  if (typeof v === 'object') {
    if (v.formattedAddress) return String(v.formattedAddress)
    if (v.address) return String(v.address)
    if (Array.isArray(v.coordinates) && v.coordinates.length >= 2) {
      return `${v.coordinates[1]}, ${v.coordinates[0]}`
    }
  }
  return null
}

/**
 * Release the marketplace assignment when a booking ends without confirmation.
 * Slot capacity is only consumed on confirmed bookings, so we do not adjust
 * slotsLeft here.
 */
async function releaseBookingAssignmentResources(booking) {
  const assignmentId = booking.assignmentId
  if (!assignmentId) return

  await VehicleRouteAssignment.findByIdAndUpdate(assignmentId, {
    $set: { isReleased: true }
  })
}

async function consumeConfirmedBookingSlot(postId, session) {
  const post = await VehicleRouteAvailability.findOneAndUpdate(
    {
      _id: postId,
      status: { $in: ['active', 'fulfilled'] },
      slotsLeft: { $gt: 0 }
    },
    { $inc: { slotsLeft: -1 } },
    { new: true, session }
  )

  if (!post) {
    throw new Error('No slots available on this post')
  }

  if (post.slotsLeft === 0 && post.status !== 'fulfilled') {
    post.status = 'fulfilled'
    await post.save({ session })
  } else if (post.slotsLeft > 0 && post.status === 'fulfilled') {
    post.status = 'active'
    await post.save({ session })
  }

  return post
}

/**
 * Create a booking request
 * POST /api/vehicle-bookings
 */
const createBooking = async (req, res, next) => {
  try {
    const buyerId = getTransporterActorId(req.user)
    if (!buyerId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can create bookings'
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
    const assignment = await VehicleRouteAssignment.findById(assignmentId)
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
    if (!assignment || assignment.isReleased === true) {
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

    // buyerId/sellerId are always Transporter document ids (actor scope matches getTransporterActorId).
    const sellerId = assignment.transporterId

    // Buyer cannot book their own vehicle
    if (buyerId.toString() === sellerId.toString()) {
      return res
        .status(400)
        .json({ success: false, message: 'You cannot book your own vehicle' })
    }

    const existingBooking = await VehicleBooking.findOne({
      postId,
      buyerId,
      status: { $in: ['DRAFT', 'REQUESTED', 'NEGOTIATING', 'CONFIRMED'] }
    })

    if (existingBooking) {
      if (
        existingBooking.status === 'DRAFT' &&
        existingBooking.assignmentId.toString() === assignmentId.toString()
      ) {
        const populatedBooking = await VehicleBooking.findById(existingBooking._id)
          .populate('buyerId', 'name mobile company')
          .populate('sellerId', 'name mobile company')
          .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
          .lean()
        return res.status(200).json({
          success: true,
          message: 'Booking inquiry already exists',
          data: { booking: populatedBooking }
        })
      }
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
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      })
    }

    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can view bookings'
      })
    }

    const booking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .populate('postId', 'origin destination availableFrom availableTo')
      .populate('tripId', 'status closedAt closedReason')
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

    const messages = await TransporterMessage.find({ bookingId: id })
      .populate('senderId', 'name mobile')
      .sort({ createdAt: 1 })
      .lean()

    return res.status(200).json({
      success: true,
      data: {
        booking,
        messages,
        unreadCount: 0
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
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can list bookings'
      })
    }

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
          receiverId: new mongoose.Types.ObjectId(userId),
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
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can propose prices'
      })
    }
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
    booking.proposalAcknowledgedBy = null
    booking.proposalAcknowledgedAt = null
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

    try {
      const io = getIO()
      const recipientId = isBuyer ? booking.sellerId : booking.buyerId
      const populatedMsg = await TransporterMessage.findById(message._id)
        .populate('senderId', 'name mobile company')
        .populate('receiverId', 'name mobile')
        .lean()
      const chatPayload = buildChatMessageSocketPayload(
        id,
        populatedMsg,
        userId
      )
      io.to(`chat:${id}`).emit('chat:message:new', chatPayload)
      io.to(`transporter:${recipientId}`).emit('chat:message:new', chatPayload)
      io.to(`transporter:${recipientId}`).emit('message:new', chatPayload)
      io.to(`transporter:${recipientId}`).emit('booking:price-proposed', {
        booking: populatedBooking,
        message: populatedMsg
      })

      try {
        const notif = buildMarketplaceMessageNotificationFields({
          bookingId: id,
          populatedMessageLean: populatedMsg
        })
        await Notification.create({
          userId: recipientId,
          userType: 'TRANSPORTER',
          type: 'MARKETPLACE_MESSAGE',
          title: notif.title,
          message: notif.message,
          data: notif.data
        })
      } catch (notifyErr) {
        console.warn(
          'Marketplace notification skipped:',
          notifyErr.message || notifyErr
        )
      }
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
 * Receiver accepts the latest numeric proposal (required before seller can confirm if seller made the last offer).
 * PUT /api/vehicle-bookings/:id/accept-proposal
 */
const acceptProposal = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can accept proposals'
      })
    }

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      })
    }

    const isBuyer = booking.buyerId.toString() === userId
    const isSeller = booking.sellerId.toString() === userId
    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this booking'
      })
    }

    if (booking.proposalAcknowledgedBy?.toString() === userId) {
      const populatedBookingEarly = await VehicleBooking.findById(id)
        .populate('buyerId', 'name mobile company')
        .populate('sellerId', 'name mobile company')
        .populate('vehicleId', 'vehicleNumber vehicleType')
        .lean()
      return res.status(200).json({
        success: true,
        message: 'Price offer already accepted',
        data: { booking: populatedBookingEarly }
      })
    }

    if (!['REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot accept a proposal for booking in ${booking.status} status`
      })
    }

    const proposedBy = booking.lastPriceProposal?.proposedBy?.toString()
    const price = booking.lastPriceProposal?.proposedPrice
    if (!proposedBy || price == null) {
      return res.status(400).json({
        success: false,
        message: 'No pending price proposal to accept'
      })
    }
    if (proposedBy === userId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot accept your own price proposal'
      })
    }

    booking.proposalAcknowledgedBy = userId
    booking.proposalAcknowledgedAt = new Date()
    await booking.save()

    await VehicleBookingAudit.logAction({
      bookingId: id,
      action: BOOKING_AUDIT_ACTIONS.PRICE_ACCEPTED,
      performedBy: userId,
      details: { proposedPrice: price, proposedBy }
    })

    const receiverId = isBuyer ? booking.sellerId : booking.buyerId
    const systemContent = isSeller
      ? 'Offer accepted. The other party can confirm the booking to create the trip.'
      : 'Offer accepted. You can confirm the booking now to create the trip.'

    try {
      const sysMessage = await TransporterMessage.create({
        bookingId: id,
        senderId: userId,
        receiverId,
        messageType: 'SYSTEM',
        content: systemContent,
        proposedPrice: null,
        status: 'DELIVERED'
      })
      const io = getIO()
      const populatedMsg = await TransporterMessage.findById(sysMessage._id)
        .populate('senderId', 'name mobile company')
        .populate('receiverId', 'name mobile')
        .lean()
      const chatPayload = buildChatMessageSocketPayload(id, populatedMsg, userId)
      io.to(`chat:${id}`).emit('chat:message:new', chatPayload)
      io.to(`transporter:${receiverId}`).emit('chat:message:new', chatPayload)
      io.to(`transporter:${receiverId}`).emit('message:new', chatPayload)
      try {
        const notif = buildMarketplaceMessageNotificationFields({
          bookingId: id,
          populatedMessageLean: populatedMsg
        })
        await Notification.create({
          userId: receiverId,
          userType: 'TRANSPORTER',
          type: 'MARKETPLACE_MESSAGE',
          title: notif.title,
          message: notif.message,
          data: notif.data
        })
      } catch (notifErr) {
        console.warn('Marketplace accept notification skipped:', notifErr.message || notifErr)
      }
    } catch (chatErr) {
      console.warn('Offer-accepted chat message failed:', chatErr.message || chatErr)
    }

    const populatedBooking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType')
      .lean()

    return res.status(200).json({
      success: true,
      message: 'Price offer accepted',
      data: { booking: populatedBooking }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Receiver declines the latest proposal (non-terminal; clears pending offer).
 * PUT /api/vehicle-bookings/:id/decline-proposal
 */
const declineProposal = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can decline proposals'
      })
    }

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      })
    }

    const isBuyer = booking.buyerId.toString() === userId
    const isSeller = booking.sellerId.toString() === userId
    if (!isBuyer && !isSeller) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this booking'
      })
    }

    if (!['REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot decline a proposal for booking in ${booking.status} status`
      })
    }

    const proposedBy = booking.lastPriceProposal?.proposedBy?.toString()
    const price = booking.lastPriceProposal?.proposedPrice
    if (!proposedBy || price == null) {
      return res.status(400).json({
        success: false,
        message: 'No pending price proposal to decline'
      })
    }
    if (proposedBy === userId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot decline your own price proposal'
      })
    }

    const receiverId =
      booking.buyerId.toString() === userId
        ? booking.sellerId
        : booking.buyerId

    booking.lastPriceProposal = {
      proposedBy: null,
      proposedPrice: null,
      proposedAt: null
    }
    booking.proposalAcknowledgedBy = null
    booking.proposalAcknowledgedAt = null
    await booking.save()

    await TransporterMessage.create({
      bookingId: id,
      senderId: userId,
      receiverId,
      messageType: 'TEXT',
      content: 'Declined the latest price offer.',
      status: 'DELIVERED'
    })

    await VehicleBookingAudit.logAction({
      bookingId: id,
      action: BOOKING_AUDIT_ACTIONS.STATUS_CHANGED,
      performedBy: userId,
      details: { event: 'PROPOSAL_DECLINED', previousPrice: price }
    })

    const populatedBooking = await VehicleBooking.findById(id)
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType')
      .lean()

    return res.status(200).json({
      success: true,
      message: 'Offer declined',
      data: { booking: populatedBooking }
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
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can accept bookings'
      })
    }

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      })
    }

    // 🔒 Only seller can accept
    if (booking.sellerId.toString() !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Only the vehicle seller can accept this booking'
      })
    }

    // 🔒 Valid status check
    if (!['REQUESTED', 'NEGOTIATING'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot accept booking in ${booking.status} status`
      })
    }

    const lastProposedBy = booking.lastPriceProposal?.proposedBy?.toString()
    if (lastProposedBy === booking.sellerId.toString()) {
      if (booking.proposalAcknowledgedBy?.toString() !== booking.buyerId.toString()) {
        return res.status(400).json({
          success: false,
          message:
            'The buyer must accept your latest price offer before you can confirm this booking.'
        })
      }
    }

    // 🔒 CHECK: vehicle still available (prevents double booking)
    // New confirmation flow: consume capacity only when the booking is formally
    // confirmed, not when a vehicle is merely attached to the post.
    const finalPrice =
      booking.lastPriceProposal?.proposedPrice || booking.estimatedPrice

    const session = await mongoose.startSession()
    session.startTransaction()

    let trip = null
    let populatedBooking = null

    try {
      const assignmentExists = await VehicleRouteAssignment.findOne({
        _id: booking.assignmentId,
        isReleased: { $ne: true }
      }).session(session)

      if (!assignmentExists) {
        throw new Error('Vehicle already booked by another user')
      }

      booking.agreedPrice = finalPrice
      booking.status = 'CONFIRMED'
      booking.acceptedAt = new Date()
      booking.confirmedAt = new Date()

      await consumeConfirmedBookingSlot(booking.postId, session)

      if (!booking.tripId) {
        trip = await createTripFromBooking(booking, { session })
      }

      await VehicleRouteAssignment.findByIdAndUpdate(
        booking.assignmentId,
        { $set: { isReleased: true } },
        { session }
      )

      await booking.save({ session })

      populatedBooking = await VehicleBooking.findById(id)
        .populate('buyerId', 'name mobile company')
        .populate('sellerId', 'name mobile company')
        .populate('vehicleId', 'vehicleNumber vehicleType')
        .lean()

      await session.commitTransaction()
    } catch (error) {
      await session.abortTransaction()
      session.endSession()
      throw error
    }

    session.endSession()

    try {
      await TransporterMessage.create({
        bookingId: id,
        senderId: userId,
        receiverId: booking.buyerId,
        messageType: 'ACCEPTED',
        content: `Booking accepted at ₹${finalPrice}`,
        proposedPrice: finalPrice
      })
    } catch (e) {
      console.warn('TransporterMessage create failed (accept booking):', e.message || e)
    }

    try {
      await VehicleBookingAudit.logAction({
        bookingId: id,
        action: BOOKING_AUDIT_ACTIONS.CONFIRMED,
        performedBy: userId,
        details: {
          agreedPrice: finalPrice
        }
      })
    } catch (e) {
      console.warn('VehicleBookingAudit.logAction failed (accept booking):', e.message || e)
    }

    if (trip) {
      try {
        const io = getIO()
        const payload = { trip, bookingId: booking._id }
        io.to(`transporter:${booking.buyerId}`).emit(
          'trip:created:from-booking',
          payload
        )
        io.to(`transporter:${booking.sellerId}`).emit(
          'trip:created:from-booking',
          payload
        )
      } catch (err) {
        console.warn('Socket emit failed (trip:created:from-booking)')
      }
    }

    try {
      const io = getIO()

      io.to(`transporter:${booking.buyerId}`).emit('booking:confirmed', {
        booking: populatedBooking
      })

      io.to(`transporter:${booking.sellerId}`).emit('booking:confirmed', {
        booking: populatedBooking
      })
    } catch (err) {
      console.warn('Socket emit failed (booking:confirmed)')
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
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can reject bookings'
      })
    }
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

    await releaseBookingAssignmentResources(booking)

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
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can cancel bookings'
      })
    }
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

    await releaseBookingAssignmentResources(booking)

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
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can view booking stats'
      })
    }

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
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can submit bookings'
      })
    }

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
        message: `Cannot submit booking in ${booking.status} status`
      })
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

/**
 * Marketplace chat list (WhatsApp-style): bookings + last message + unread
 * GET /api/vehicle-bookings/conversations
 */
const getConversations = async (req, res, next) => {
  try {
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can list conversations'
      })
    }

    const userObjectId = new mongoose.Types.ObjectId(userId)
    const bookings = await VehicleBooking.find({
      $and: [
        { $or: [{ buyerId: userId }, { sellerId: userId }] },
        { $nor: [{ inboxHiddenBy: userObjectId }] },
      ],
    })
      .populate('buyerId', 'name mobile company')
      .populate('sellerId', 'name mobile company')
      .populate('vehicleId', 'vehicleNumber vehicleType')
      .populate('postId', 'origin destination availableFrom availableTo')
      .populate('tripId', 'status closedAt closedReason')
      .lean()

    const ids = bookings.map(b => b._id)
    if (ids.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Conversations retrieved',
        data: { conversations: [], total: 0 }
      })
    }

    const lastByBooking = await TransporterMessage.aggregate([
      { $match: { bookingId: { $in: ids } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$bookingId',
          lastMessageId: { $first: '$_id' }
        }
      }
    ])
    const lastIds = lastByBooking.map(x => x.lastMessageId).filter(Boolean)
    const lastMsgs = lastIds.length
      ? await TransporterMessage.find({ _id: { $in: lastIds } })
          .populate('senderId', 'name mobile company')
          .populate('receiverId', 'name mobile')
          .lean()
      : []
    const lastMap = {}
    for (const m of lastMsgs) {
      lastMap[m.bookingId.toString()] = m
    }

    const unreadAgg = await TransporterMessage.aggregate([
      {
        $match: {
          bookingId: { $in: ids },
          receiverId: new mongoose.Types.ObjectId(userId),
          status: { $ne: 'READ' }
        }
      },
      { $group: { _id: '$bookingId', count: { $sum: 1 } } }
    ])
    const unreadMap = unreadAgg.reduce((acc, u) => {
      acc[u._id.toString()] = u.count
      return acc
    }, {})

    const conversations = bookings.map(b => {
      const bid = b._id.toString()
      const buyerRef = b.buyerId
      const buyerKey =
        buyerRef && typeof buyerRef === 'object' && buyerRef._id
          ? buyerRef._id.toString()
          : buyerRef?.toString?.() ?? `${buyerRef}`
      const isBuyer = buyerKey === userId
      const counterparty = isBuyer ? b.sellerId : b.buyerId
      const lastMessage = lastMap[bid] || null
      const uAt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
      const mAt = lastMessage?.createdAt
        ? new Date(lastMessage.createdAt).getTime()
        : 0
      const lastActivityAt = new Date(Math.max(uAt, mAt))

      const post = b.postId
      const bookingForList =
        post && typeof post === 'object'
          ? {
              ...b,
              postId: {
                ...post,
                originLabel: geoFieldToLabel(post.origin),
                destinationLabel: geoFieldToLabel(post.destination)
              }
            }
          : b

      return {
        booking: bookingForList,
        lastMessage,
        unreadCount: unreadMap[bid] || 0,
        counterparty,
        lastActivityAt
      }
    })

    conversations.sort(
      (a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime()
    )

    return res.status(200).json({
      success: true,
      message: 'Conversations retrieved',
      data: { conversations, total: conversations.length }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Hide booking thread from current user's chats list only (does not cancel booking).
 * PATCH /api/vehicle-bookings/:id/hide-from-inbox
 */
const hideBookingFromInbox = async (req, res, next) => {
  try {
    const { id } = req.params
    const userId = getTransporterActorId(req.user)
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can update conversations'
      })
    }

    const booking = await VehicleBooking.findById(id)
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      })
    }

    if (
      booking.buyerId.toString() !== userId &&
      booking.sellerId.toString() !== userId
    ) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this booking'
      })
    }

    const actorOid = new mongoose.Types.ObjectId(userId)
    await VehicleBooking.updateOne(
      { _id: id },
      { $addToSet: { inboxHiddenBy: actorOid } }
    )

    return res.status(200).json({
      success: true,
      message: 'Conversation removed from your inbox'
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createBooking,
  getBooking,
  getMyBookings,
  getConversations,
  hideBookingFromInbox,
  proposePriceOffer,
  acceptProposal,
  declineProposal,
  acceptBooking,
  rejectBooking,
  cancelBooking,
  submitBooking,
  getBookingStats
}
