const { Server } = require('socket.io')
const { verifyToken } = require('./jwt.service')
const Transporter = require('../models/Transporter')
const Driver = require('../models/Driver')
const Trip = require('../models/Trip')
const Vehicle = require('../models/Vehicle')
const Customer = require('../models/Customer')
const Admin = require('../models/Admin')
const CompanyUser = require('../models/CompanyUser')
const { activateNextTrip } = require('./tripQueue.service')
const {
  getMilestoneTypeByNumber,
  getBackendMeaning,
  getDriverLabel
} = require('../utils/milestoneMapping')
const { TRIP_STATUS, calculatePodDueAt } = require('../utils/tripState')
const {
  ensureMilestonePhoto,
  toAuditUserType
} = require('./tripLifecycle.service')

const TransporterMessage = require('../models/TransporterMessage')
const Notification = require('../models/Notification')
const { getTransporterActorId } = require('../utils/transporterActor')
const { buildChatMessageSocketPayload } = require('../utils/marketplaceChatPayload')
const env = require('../config/env')
let io = null

const getTripVehicleSelector = trip => {
  if (trip.vehicleId) {
    return { vehicleId: trip.vehicleId }
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return { 'hiredVehicle.vehicleNumber': trip.hiredVehicle.vehicleNumber }
  }

  return null
}

const getTripVehicleRoom = trip => {
  if (trip.vehicleId) {
    return `vehicle:${trip.vehicleId}`
  }

  if (trip.hiredVehicle?.vehicleNumber) {
    return `vehicle:hired:${trip.hiredVehicle.vehicleNumber}`
  }

  return null
}

/** Transporter id for socket user (company users act as their transporter). */
const getTransporterScopeId = getTransporterActorId

/**
 * Structured logs for transporter / company-user socket lifecycle (debugging connectivity).
 */
const logTransporterSocketLifecycle = (event, socket, extra = {}) => {
  const u = socket.user
  if (
    !u ||
    (u.userType !== 'transporter' && u.userType !== 'company-user')
  ) {
    return
  }
  const transport = socket.conn?.transport?.name
  const xf = socket.handshake.headers['x-forwarded-for']
  const clientIp =
    (typeof xf === 'string' && xf.split(',')[0]?.trim()) ||
    socket.handshake.address ||
    null
  const ua = socket.handshake.headers['user-agent']
  const row = {
    event,
    socketId: socket.id,
    userType: u.userType,
    jwtUserId: u.id,
    transporterScopeId: getTransporterScopeId(u),
    transport: transport || null,
    clientIp,
    userAgent: ua ? String(ua).slice(0, 160) : null,
    ...extra
  }
  console.log('[Socket/transporter]', JSON.stringify(row))
}

const emitToTripAudience = (eventName, payload, options = {}) => {
  if (!io || !payload?.trip) {
    return
  }

  const trip = payload.trip

  if (trip.transporterId) {
    io.to(`transporter:${trip.transporterId._id || trip.transporterId}`).emit(
      eventName,
      payload
    )
  }

  if (trip.driverId) {
    io.to(`driver:${trip.driverId._id || trip.driverId}`).emit(
      eventName,
      payload
    )
  }

  if (trip.customerId && !options.excludeCustomer) {
    io.to(`customer:${trip.customerId._id || trip.customerId}`).emit(
      eventName,
      payload
    )
  }

  const vehicleRoom = getTripVehicleRoom(trip)
  if (vehicleRoom) {
    io.to(vehicleRoom).emit(eventName, payload)
  }

  io.to(`trip:${trip._id || trip.id}`).emit(eventName, payload)

  // Admin receives all trip events
  io.to('admin:all').emit(eventName, payload)
}

/**
 * Initialize Socket.IO server
 * @param {Object} httpServer - HTTP server instance
 * @returns {Object} Socket.IO server instance
 */
const initializeSocketIO = httpServer => {
  io = new Server(httpServer, {
    path: env.socketIoPath,
    cors: {
      origin: '*', // Configure based on your frontend URL
      methods: ['GET', 'POST'],
      credentials: true
    }
  })

  // Authentication middleware for Socket.IO
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        return next(new Error('Authentication error: No token provided'))
      }

      try {
        const decoded = verifyToken(token)

        // Fetch user based on userType
        let user = null
        if (decoded.userType === 'transporter') {
          user = await Transporter.findById(decoded.userId)
        } else if (decoded.userType === 'company-user') {
          user = await CompanyUser.findById(decoded.userId)
        } else if (decoded.userType === 'driver') {
          user = await Driver.findById(decoded.userId)
        } else if (decoded.userType === 'customer') {
          user = await Customer.findById(decoded.userId)
        } else if (decoded.userType === 'admin') {
          user = await Admin.findById(decoded.userId)
        }

        if (!user) {
          return next(new Error('Authentication error: User not found'))
        }

        if (user.status === 'blocked' || user.status === 'inactive') {
          return next(
            new Error('Authentication error: Account blocked or inactive')
          )
        }

        // Attach user to socket
        if (decoded.userType === 'company-user') {
          socket.user = {
            id: user._id.toString(),
            mobile: user.mobile || user.email,
            userType: 'company-user',
            transporterId: user.transporterId.toString(),
            userData: user
          }
        } else {
          socket.user = {
            id: user._id.toString(),
            mobile: user.mobile || user.email,
            userType: decoded.userType,
            userData: user
          }
        }

        next()
      } catch (tokenError) {
        return next(new Error(`Authentication error: ${tokenError.message}`))
      }
    } catch (error) {
      next(new Error(`Authentication error: ${error.message}`))
    }
  })

  // Connection handler
  io.on('connection', socket => {
    console.log(
      `Socket connected: ${socket.id} (${socket.user.userType}: ${socket.user.id})`
    )

    // Join user-specific rooms
    if (socket.user.userType === 'transporter') {
      socket.join(`transporter:${socket.user.id}`)
      // 🔥 USER ONLINE EVENT
      const transporterScopeId = getTransporterScopeId(socket.user)
      if (transporterScopeId) {
        io.to(`transporter:${transporterScopeId}`).emit('user:online', {
          userId: transporterScopeId
        })
      }
    } else if (
      socket.user.userType === 'company-user' &&
      socket.user.transporterId
    ) {
      socket.join(`transporter:${socket.user.transporterId}`)
    } else if (socket.user.userType === 'driver') {
      socket.join(`driver:${socket.user.id}`)
    } else if (socket.user.userType === 'customer') {
      socket.join(`customer:${socket.user.id}`)
    } else if (socket.user.userType === 'admin') {
      socket.join(`admin:${socket.user.id}`)
      socket.join('admin:all')
    }

    if (
      socket.user.userType === 'transporter' ||
      socket.user.userType === 'company-user'
    ) {
      logTransporterSocketLifecycle('connected', socket)
    }

    // Handle room joins
    socket.on('join:transporter', transporterId => {
      const id = transporterId?.toString?.() ?? transporterId
      if (socket.user.userType === 'transporter' && socket.user.id === id) {
        socket.join(`transporter:${id}`)
        console.log(`Socket ${socket.id} joined transporter:${id}`)
      } else if (
        socket.user.userType === 'company-user' &&
        socket.user.transporterId === id
      ) {
        socket.join(`transporter:${id}`)
        console.log(
          `Socket ${socket.id} joined transporter:${id} (company-user)`
        )
      }
    })

    socket.on('join:driver', driverId => {
      if (socket.user.userType === 'driver' && socket.user.id === driverId) {
        socket.join(`driver:${driverId}`)
        console.log(`Socket ${socket.id} joined driver:${driverId}`)
      }
    })

    socket.on('join:customer', customerId => {
      if (
        socket.user.userType === 'customer' &&
        socket.user.id === customerId
      ) {
        socket.join(`customer:${customerId}`)
        console.log(`Socket ${socket.id} joined customer:${customerId}`)
      }
    })

    socket.on('join:vehicle', async vehicleId => {
      try {
        const vid = vehicleId?.toString?.() ?? vehicleId
        if (!vid) return

        const vehicle = await Vehicle.findById(vid)
        if (!vehicle) {
          console.warn(
            `Socket ${socket.id} join:vehicle denied — vehicle not found`
          )
          return
        }

        const ut = socket.user.userType
        if (ut === 'admin') {
          socket.join(`vehicle:${vid}`)
          console.log(`Socket ${socket.id} joined vehicle:${vid} (admin)`)
          return
        }

        if (ut === 'driver') {
          if (
            vehicle.driverId &&
            vehicle.driverId.toString() === socket.user.id
          ) {
            socket.join(`vehicle:${vid}`)
            console.log(`Socket ${socket.id} joined vehicle:${vid} (driver)`)
          }
          return
        }

        const scopeId = getTransporterScopeId(socket.user)
        if (!scopeId) return

        const ownerMatch = vehicle.transporterId.toString() === scopeId
        const hired = (vehicle.hiredBy || []).some(
          h => h.toString() === scopeId
        )
        if (!ownerMatch && !hired) {
          console.warn(
            `Socket ${socket.id} join:vehicle denied — not owner/hirer`
          )
          return
        }

        socket.join(`vehicle:${vid}`)
        console.log(`Socket ${socket.id} joined vehicle:${vid}`)
      } catch (err) {
        console.error('join:vehicle error', err)
      }
    })

    socket.on('join:trip', async tripId => {
      try {
        const tid = tripId?.toString?.() ?? tripId
        if (!tid) return

        const trip = await Trip.findById(tid).select(
          'transporterId driverId customerId'
        )
        if (!trip) {
          console.warn(`Socket ${socket.id} join:trip denied — trip not found`)
          return
        }

        const ut = socket.user.userType
        if (ut === 'admin') {
          socket.join(`trip:${tid}`)
          console.log(`Socket ${socket.id} joined trip:${tid} (admin)`)
          return
        }

        if (ut === 'driver') {
          if (trip.driverId && trip.driverId.toString() === socket.user.id) {
            socket.join(`trip:${tid}`)
            console.log(`Socket ${socket.id} joined trip:${tid} (driver)`)
          } else {
            console.warn(
              `Socket ${socket.id} join:trip denied — not assigned driver`
            )
          }
          return
        }

        if (ut === 'customer') {
          if (
            trip.customerId &&
            trip.customerId.toString() === socket.user.id
          ) {
            socket.join(`trip:${tid}`)
            console.log(`Socket ${socket.id} joined trip:${tid} (customer)`)
          }
          return
        }

        const scopeId = getTransporterScopeId(socket.user)
        if (!scopeId) return
        if (trip.transporterId && trip.transporterId.toString() === scopeId) {
          socket.join(`trip:${tid}`)
          console.log(`Socket ${socket.id} joined trip:${tid}`)
        } else {
          console.warn(
            `Socket ${socket.id} join:trip denied — wrong transporter`
          )
        }
      } catch (err) {
        console.error('join:trip error', err)
      }
    })

    // Handle trip start (from driver app)
    socket.on('trip:start', async data => {
      try {
        const { tripId } = data

        if (!tripId) {
          return socket.emit('error', { message: 'Trip ID is required' })
        }

        // Only drivers can start trips via Socket.IO
        if (socket.user.userType !== 'driver') {
          return socket.emit('error', {
            message: 'Only drivers can start trips'
          })
        }

        // Find trip
        const trip = await Trip.findById(tripId)
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' })
        }

        // Check driver access
        if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
          return socket.emit('error', {
            message: 'Access denied. This trip is not assigned to you.'
          })
        }

        // Validate trip status
        if (trip.status !== TRIP_STATUS.PLANNED) {
          return socket.emit('error', {
            message: `Trip cannot be started. Current status: ${trip.status}`
          })
        }

        const vehicleSelector = getTripVehicleSelector(trip)
        if (!vehicleSelector) {
          return socket.emit('error', {
            message: 'Trip must have an assigned owned or hired vehicle'
          })
        }

        if (!trip.driverId) {
          return socket.emit('error', {
            message: 'Trip must have an assigned driver'
          })
        }

        // Check for active trip on vehicle
        const activeTrip = await Trip.findOne({
          ...vehicleSelector,
          status: TRIP_STATUS.ACTIVE,
          _id: { $ne: trip._id }
        })

        if (activeTrip) {
          return socket.emit('error', {
            message: 'Vehicle already has an active trip'
          })
        }

        // Update trip status
        trip.status = TRIP_STATUS.ACTIVE
        await trip.save()

        // Get current milestone
        const currentMilestone = trip.getCurrentMilestone()
        const milestoneLabel = currentMilestone
          ? getDriverLabel(currentMilestone.milestoneType)
          : null

        // Broadcast trip started event (transporter, driver, customer, vehicle, trip room, admin)
        const startedPayload = {
          trip: trip.toObject(),
          currentMilestone: currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel
              }
            : null
        }
        emitToTripAudience('trip:started', startedPayload)
      } catch (error) {
        console.error('Error handling trip:start:', error)
        socket.emit('error', {
          message: error.message || 'Failed to start trip'
        })
      }
    })

    // Handle milestone update (from driver app)
    socket.on('trip:milestone:update', async data => {
      try {
        const { tripId, milestoneNumber, latitude, longitude, photo } = data

        if (
          !tripId ||
          !milestoneNumber ||
          latitude === undefined ||
          longitude === undefined
        ) {
          return socket.emit('error', {
            message: 'Trip ID, milestone number, and GPS location are required'
          })
        }

        // Only drivers can update milestones
        if (socket.user.userType !== 'driver') {
          return socket.emit('error', {
            message: 'Only drivers can update milestones'
          })
        }

        const milestoneNum = parseInt(milestoneNumber)
        if (milestoneNum < 1 || milestoneNum > 5) {
          return socket.emit('error', {
            message: 'Milestone number must be between 1 and 5'
          })
        }
        if (milestoneNum === 5) {
          return socket.emit('error', {
            message:
              'Milestone 5 (Trip Completed) is completed via POD upload. Use the Upload POD action instead.'
          })
        }

        // Find trip
        const trip = await Trip.findById(tripId)
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' })
        }

        // Check driver access
        if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
          return socket.emit('error', {
            message: 'Access denied. This trip is not assigned to you.'
          })
        }

        // Validate trip is ACTIVE
        if (trip.status !== TRIP_STATUS.ACTIVE) {
          return socket.emit('error', {
            message: `Milestones can only be updated for ACTIVE trips. Current status: ${trip.status}`
          })
        }

        // Validate milestone sequence
        const completedMilestones = trip.milestones.length
        const expectedNext = completedMilestones + 1

        if (milestoneNum !== expectedNext) {
          return socket.emit('error', {
            message: `Invalid milestone sequence. Expected milestone ${expectedNext}, got ${milestoneNum}`
          })
        }

        // Get milestone type and backend meaning
        const milestoneType = getMilestoneTypeByNumber(milestoneNum)
        const backendMeaning = getBackendMeaning(milestoneType, trip.tripType)

        const photoValidationError = ensureMilestonePhoto(
          trip,
          milestoneType,
          photo || null
        )
        if (photoValidationError) {
          return socket.emit('error', { message: photoValidationError })
        }

        // Create milestone object
        const photos = photo ? [photo] : []
        const milestone = {
          milestoneType,
          milestoneNumber: milestoneNum,
          timestamp: new Date(),
          location: {
            latitude,
            longitude
          },
          photo: photo || null,
          photos,
          driverId: socket.user.id,
          backendMeaning
        }

        // Add milestone to trip
        trip.milestones.push(milestone)
        trip.lastDriverLocation = {
          latitude,
          longitude,
          updatedAt: new Date()
        }
        trip.audit.updatedBy = {
          userId: socket.user.id,
          userType: toAuditUserType(socket.user.userType)
        }
        await trip.save()

        // Get current milestone for next milestone
        const currentMilestone = trip.getCurrentMilestone()
        const milestoneLabel = currentMilestone
          ? getDriverLabel(currentMilestone.milestoneType)
          : null

        // Broadcast milestone updated event (transporter, driver, customer, vehicle, trip room, admin)
        const milestonePayload = {
          trip: trip.toObject(),
          milestone,
          currentMilestone: currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel
              }
            : null
        }
        emitToTripAudience('trip:milestone:updated', milestonePayload)
      } catch (error) {
        console.error('Error handling trip:milestone:update:', error)
        socket.emit('error', {
          message: error.message || 'Failed to update milestone'
        })
      }
    })

    // Handle driver location update (from driver app, for real-time tracking)
    socket.on('driver:location:update', async data => {
      try {
        const { tripId, latitude, longitude } = data

        if (!tripId || latitude === undefined || longitude === undefined) {
          return socket.emit('error', {
            message: 'Trip ID and GPS coordinates are required'
          })
        }

        const lat = parseFloat(latitude)
        const lng = parseFloat(longitude)
        if (
          isNaN(lat) ||
          isNaN(lng) ||
          lat < -90 ||
          lat > 90 ||
          lng < -180 ||
          lng > 180
        ) {
          return socket.emit('error', { message: 'Invalid coordinates' })
        }

        if (socket.user.userType !== 'driver') {
          return socket.emit('error', {
            message: 'Only drivers can send location updates'
          })
        }

        const trip = await Trip.findById(tripId)
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' })
        }

        if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
          return socket.emit('error', {
            message: 'Access denied. This trip is not assigned to you.'
          })
        }

        if (trip.status !== TRIP_STATUS.ACTIVE) {
          return socket.emit('error', {
            message: `Location updates only allowed for ACTIVE trips. Current status: ${trip.status}`
          })
        }

        trip.lastDriverLocation = {
          latitude: lat,
          longitude: lng,
          updatedAt: new Date()
        }
        await trip.save()

        const payload = {
          tripId: trip._id.toString(),
          trip: trip.toObject(),
          latitude: lat,
          longitude: lng,
          timestamp: new Date().toISOString()
        }

        emitToTripAudience('driver:location:updated', payload)
      } catch (error) {
        console.error('Error handling driver:location:update:', error)
        socket.emit('error', {
          message: error.message || 'Failed to update location'
        })
      }
    })

    // Handle trip complete (from driver app)
    socket.on('trip:complete', async data => {
      try {
        const { tripId } = data

        if (!tripId) {
          return socket.emit('error', { message: 'Trip ID is required' })
        }

        // Only drivers can complete trips via Socket.IO
        if (socket.user.userType !== 'driver') {
          return socket.emit('error', {
            message: 'Only drivers can complete trips'
          })
        }

        // Find trip
        const trip = await Trip.findById(tripId)
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' })
        }

        // Check driver access
        if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
          return socket.emit('error', {
            message: 'Access denied. This trip is not assigned to you.'
          })
        }

        // Validate trip status
        if (trip.status !== TRIP_STATUS.ACTIVE) {
          return socket.emit('error', {
            message: `Trip cannot be completed. Current status: ${trip.status}`
          })
        }

        // Validate all milestones are completed
        if (!trip.areAllMilestonesCompleted()) {
          return socket.emit('error', {
            message:
              'All 5 milestones must be completed before completing the trip',
            completedMilestones: trip.milestones.length,
            requiredMilestones: 5
          })
        }

        // Milestone completion moves the trip to POD pending.
        trip.completedAt = new Date()
        trip.podDueAt = calculatePodDueAt(trip.completedAt)
        trip.closedAt = null
        trip.closedReason = null
        trip.status = TRIP_STATUS.POD_PENDING
        trip.podTimerStartedAt = trip.completedAt
        trip.audit.updatedBy = {
          userId: socket.user.id,
          userType: toAuditUserType(socket.user.userType)
        }
        await trip.save()

        // Broadcast pod pending event (transporter, driver, customer, vehicle, trip room, admin)
        emitToTripAudience('trip:pod:pending', { trip: trip.toObject() })

        // Auto-activate next queued trip
        try {
          const nextTrip = await activateNextTrip(trip)
          if (nextTrip) {
            emitTripAutoActivated(nextTrip)
          }
        } catch (queueError) {
          console.error(
            'Error in auto-queue after trip completion:',
            queueError
          )
          // Don't fail the trip completion if auto-queue fails
        }
      } catch (error) {
        console.error('Error handling trip:complete:', error)
        socket.emit('error', {
          message: error.message || 'Failed to complete trip'
        })
      }
    })
    // ================= CHAT JOIN =================
    socket.on('chat:join', async ({ bookingId }) => {
      try {
        if (!bookingId) {
          return socket.emit('error', { message: 'bookingId required' })
        }

        const actorId = getTransporterScopeId(socket.user)
        if (!actorId) {
          return socket.emit('error', { message: 'Access denied' })
        }

        const VehicleBooking = require('../models/VehicleBooking')

        const booking = await VehicleBooking.findById(bookingId)

        if (!booking) {
          return socket.emit('error', { message: 'Booking not found' })
        }

        const isAllowed =
          booking.buyerId.toString() === actorId ||
          booking.sellerId.toString() === actorId

        if (!isAllowed) {
          return socket.emit('error', { message: 'Access denied' })
        }

        socket.join(`chat:${bookingId}`)
        socket.to(`chat:${bookingId}`).emit('chat:user:joined', {
          userId: actorId
        })

        await TransporterMessage.updateMany(
          {
            bookingId,
            status: 'SENT',
            senderId: { $ne: actorId }
          },
          { status: 'DELIVERED' }
        )

        console.log(`Socket ${socket.id} joined chat:${bookingId}`)

        socket.emit('chat:joined', { bookingId })
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    // ================= SEND MESSAGE =================
    socket.on('chat:message:send', async data => {
      try {
        const { bookingId, content, messageType, proposedPrice } = data

        const actorId = getTransporterScopeId(socket.user)
        if (!actorId) {
          return socket.emit('error', { message: 'Access denied' })
        }

        if (!socket.rooms.has(`chat:${bookingId}`)) {
          return socket.emit('error', {
            message: 'Join chat first before sending message'
          })
        }

        if (!bookingId || !content) {
          return socket.emit('error', {
            message: 'bookingId and content required'
          })
        }
        if (content.length > 2000) {
          return socket.emit('error', { message: 'Message too long' })
        }

        const VehicleBooking = require('../models/VehicleBooking')

        const booking = await VehicleBooking.findById(bookingId)

        if (!booking) {
          return socket.emit('error', { message: 'Booking not found' })
        }

        const isAllowed =
          booking.buyerId.toString() === actorId ||
          booking.sellerId.toString() === actorId

        if (!isAllowed) {
          return socket.emit('error', { message: 'Access denied' })
        }

        const receiverId =
          booking.buyerId.toString() === actorId
            ? booking.sellerId
            : booking.buyerId

        const createdMsg = await TransporterMessage.create({
          bookingId,
          senderId: actorId,
          receiverId,
          content,
          messageType: messageType || 'TEXT',
          proposedPrice: proposedPrice || null,
          status: 'DELIVERED'
        })

        const populatedMessage = await TransporterMessage.findById(
          createdMsg._id
        )
          .populate('senderId', 'name mobile company')
          .populate('receiverId', 'name mobile')
          .lean()

        const payload = buildChatMessageSocketPayload(
          bookingId,
          populatedMessage,
          actorId
        )

        io.to(`chat:${bookingId}`).emit('chat:message:new', payload)
        io.to(`transporter:${receiverId}`).emit('chat:message:new', payload)
        io.to(`transporter:${receiverId}`).emit('message:new', payload)

        try {
          await Notification.create({
            userId: receiverId,
            userType: 'TRANSPORTER',
            type: 'MARKETPLACE_MESSAGE',
            title: 'Marketplace message',
            message: String(content || '').slice(0, 200),
            data: { bookingId: bookingId.toString() },
          })
        } catch (notifyErr) {
          console.warn(
            'Marketplace notification skipped:',
            notifyErr.message || notifyErr
          )
        }
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    // // ================= MESSAGE DELIVERED =================
    // socket.on('chat:message:delivered', async ({ messageId }) => {
    //   try {
    //     const message = await TransporterMessage.findByIdAndUpdate(
    //       messageId,
    //       { status: 'DELIVERED' },
    //       { new: true }
    //     )

    //     if (!message) {
    //       return socket.emit('error', { message: 'Message not found' })
    //     }

    //     io.to(`chat:${message.bookingId}`).emit('chat:message:delivered', {
    //       messageId
    //     })
    //   } catch (err) {
    //     socket.emit('error', { message: err.message })
    //   }
    // })

    // ================= MESSAGE READ =================
    socket.on('chat:message:read', async ({ messageId }) => {
      try {
        const actorId = getTransporterScopeId(socket.user)
        if (!actorId) {
          return socket.emit('error', { message: 'Access denied' })
        }

        const existing = await TransporterMessage.findById(messageId)
        if (!existing) {
          return socket.emit('error', { message: 'Message not found' })
        }
        if (existing.receiverId.toString() !== actorId) {
          return socket.emit('error', { message: 'Access denied' })
        }

        const VehicleBooking = require('../models/VehicleBooking')
        const booking = await VehicleBooking.findById(existing.bookingId)
        if (
          !booking ||
          (booking.buyerId.toString() !== actorId &&
            booking.sellerId.toString() !== actorId)
        ) {
          return socket.emit('error', { message: 'Access denied' })
        }

        const message = await TransporterMessage.findByIdAndUpdate(
          messageId,
          {
            status: 'READ',
            readAt: new Date()
          },
          { new: true }
        )

        const readPayload = {
          bookingId: message.bookingId,
          messageId,
          readAt: message.readAt
        }
        io.to(`chat:${message.bookingId}`).emit('chat:message:read', readPayload)
        io.to(`transporter:${message.senderId}`).emit(
          'chat:message:read',
          readPayload
        )
        io.to(`transporter:${message.senderId}`).emit('message:read', readPayload)
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    // ================= TYPING =================
    socket.on('chat:typing', ({ bookingId }) => {
      if (!socket.rooms.has(`chat:${bookingId}`)) return
      const actorId = getTransporterScopeId(socket.user)
      if (!actorId) return

      socket.to(`chat:${bookingId}`).emit('chat:typing', {
        senderId: actorId
      })
    })

    socket.on('chat:leave', ({ bookingId }) => {
      socket.leave(`chat:${bookingId}`)
      const actorId = getTransporterScopeId(socket.user)

      socket.to(`chat:${bookingId}`).emit('chat:user:left', {
        userId: actorId || socket.user.id
      })
    })

    // Disconnection handler
    socket.on('disconnect', reason => {
      console.log(`Socket disconnected: ${socket.id} (${reason})`)
      logTransporterSocketLifecycle('disconnected', socket, {
        reason: reason || null
      })
      // 🔥 USER OFFLINE EVENT
      const transporterScopeId = getTransporterScopeId(socket.user)
      if (transporterScopeId) {
        io.to(`transporter:${transporterScopeId}`).emit('user:offline', {
          userId: transporterScopeId
        })
      }
    })
  })

  return io
}

/**
 * Get Socket.IO instance
 * @returns {Object} Socket.IO server instance
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized. Call initializeSocketIO first.')
  }
  return io
}

/**
 * Emit trip created event to transporter
 * @param {String} transporterId - Transporter ID
 * @param {Object} trip - Trip object
 */
const emitTripCreated = (transporterId, trip) => {
  if (io) {
    io.to(`transporter:${transporterId}`).emit('trip:created', {
      trip: trip.toObject ? trip.toObject() : trip
    })
  }
}

/**
 * Emit trip created event to customer (when they book)
 * @param {String} customerId - Customer ID
 * @param {Object} trip - Trip object
 */
const emitTripCreatedForCustomer = (customerId, trip) => {
  if (io) {
    io.to(`customer:${customerId}`).emit('trip:created', {
      trip: trip.toObject ? trip.toObject() : trip
    })
  }
}

const emitBookingAccepted = trip => {
  emitToTripAudience('trip:customer:accepted', {
    trip: trip.toObject ? trip.toObject() : trip
  })
}

const emitBookingRejected = ({ trip, transporterId }) => {
  if (!io) {
    return
  }

  const tripData = trip.toObject ? trip.toObject() : trip
  if (tripData.customerId) {
    io.to(`customer:${tripData.customerId._id || tripData.customerId}`).emit(
      'trip:customer:rejected',
      {
        trip: tripData,
        transporterId
      }
    )
  }
  io.to(`transporter:${transporterId}`).emit('trip:customer:rejected', {
    tripId: tripData._id || tripData.id
  })
}

const emitTripVehicleAssigned = (trip, assignment) => {
  emitToTripAudience('trip:vehicle:assigned', {
    trip: trip.toObject ? trip.toObject() : trip,
    assignment
  })
}

const emitTripDriverAssigned = (trip, assignment) => {
  emitToTripAudience('trip:driver:assigned', {
    trip: trip.toObject ? trip.toObject() : trip,
    assignment
  })
}

const emitTripAssigned = (trip, assignment = {}) => {
  emitToTripAudience('trip:customer:assigned', {
    trip: trip.toObject ? trip.toObject() : trip,
    assignment
  })
}

const emitTripStarted = (trip, currentMilestone = null) => {
  emitToTripAudience('trip:started', {
    trip: trip.toObject ? trip.toObject() : trip,
    currentMilestone
  })
}

const emitTripMilestoneUpdated = (trip, milestone, currentMilestone = null) => {
  emitToTripAudience('trip:milestone:updated', {
    trip: trip.toObject ? trip.toObject() : trip,
    milestone,
    currentMilestone
  })
}

const emitTripPodUploaded = trip => {
  emitToTripAudience('trip:pod:uploaded', {
    trip: trip.toObject ? trip.toObject() : trip
  })
}

const emitTripCompleted = trip => {
  emitToTripAudience('trip:completed', {
    trip: trip.toObject ? trip.toObject() : trip
  })
}

const emitTripPodPending = trip => {
  emitToTripAudience('trip:pod:pending', {
    trip: trip.toObject ? trip.toObject() : trip
  })
}

const emitTripClosedWithPOD = trip => {
  emitToTripAudience('trip:closed:with-pod', {
    trip: trip.toObject ? trip.toObject() : trip
  })
}

const emitTripClosedWithoutPOD = trip => {
  emitToTripAudience('trip:closed:without-pod', {
    trip: trip.toObject ? trip.toObject() : trip
  })
}

const emitTripAutoActivated = trip => {
  emitToTripAudience(
    'trip:auto-activated',
    {
      trip: trip.toObject ? trip.toObject() : trip,
      message: 'Next trip has been auto-activated'
    },
    { excludeCustomer: true }
  )
}

const emitTripCancelled = trip => {
  emitToTripAudience('trip:cancelled', {
    trip: trip.toObject ? trip.toObject() : trip
  })
}

/**
 * Generic trip mutation (REST or other) — broadcast full trip snapshot to all audience.
 * @param {Object} trip - Trip mongoose doc or plain object
 * @param {{ reason?: string, changedFields?: string[] }} meta
 */
const emitTripUpdated = (trip, meta = {}) => {
  const tripObj = trip.toObject ? trip.toObject() : trip
  emitToTripAudience('trip:updated', {
    trip: tripObj,
    reason: meta.reason || 'trip_updated',
    changedFields: meta.changedFields || []
  })
}

/**
 * Emit vehicle status updated event
 * @param {String} vehicleId - Vehicle ID
 * @param {String} transporterId - Transporter ID
 * @param {Object} vehicle - Vehicle object
 */
const emitVehicleStatusUpdated = (vehicleId, transporterId, vehicle) => {
  if (io) {
    io.to(`vehicle:${vehicleId}`).emit('vehicle:status:updated', {
      vehicle: vehicle.toObject ? vehicle.toObject() : vehicle
    })
    io.to(`transporter:${transporterId}`).emit('vehicle:status:updated', {
      vehicle: vehicle.toObject ? vehicle.toObject() : vehicle
    })
  }
}

/**
 * Emit booking requested event (to seller)
 * @param {String} sellerId - Seller transporter ID
 * @param {Object} booking - Booking object
 */
const emitBookingRequested = (sellerId, booking) => {
  if (io) {
    io.to(`transporter:${sellerId}`).emit('booking:requested', {
      booking: booking.toObject ? booking.toObject() : booking
    })
  }
}

/**
 * Emit price proposed event
 * @param {String} recipientId - Recipient transporter ID
 * @param {Object} booking - Booking object
 * @param {Object} message - Message object
 */
const emitPriceProposed = (recipientId, booking, message) => {
  if (io) {
    io.to(`transporter:${recipientId}`).emit('booking:price-proposed', {
      booking: booking.toObject ? booking.toObject() : booking,
      message: message.toObject ? message.toObject() : message
    })
  }
}

/**
 * Emit booking confirmed event (to both parties)
 * @param {String} buyerId - Buyer transporter ID
 * @param {String} sellerId - Seller transporter ID
 * @param {Object} booking - Booking object
 */
const emitBookingConfirmed = (buyerId, sellerId, booking) => {
  if (io) {
    io.to(`transporter:${buyerId}`).emit('booking:confirmed', {
      booking: booking.toObject ? booking.toObject() : booking
    })
    io.to(`transporter:${sellerId}`).emit('booking:confirmed', {
      booking: booking.toObject ? booking.toObject() : booking
    })
  }
}

// /**
//  * Emit booking rejected event (to buyer)
//  * @param {String} buyerId - Buyer transporter ID
//  * @param {Object} booking - Booking object
//  */
// const emitBookingRejected = (buyerId, booking) => {
//   if (io) {
//     io.to(`transporter:${buyerId}`).emit('booking:rejected', {
//       booking: booking.toObject ? booking.toObject() : booking,
//     });
//   }
// };

/**
 * Emit booking cancelled event (to seller)
 * @param {String} sellerId - Seller transporter ID
 * @param {Object} booking - Booking object
 */
const emitBookingCancelled = (sellerId, booking) => {
  if (io) {
    io.to(`transporter:${sellerId}`).emit('booking:cancelled', {
      booking: booking.toObject ? booking.toObject() : booking
    })
  }
}

/**
 * Emit new message event
 * @param {String} recipientId - Recipient transporter ID
 * @param {String} bookingId - Booking ID
 * @param {Object} message - Message object
 */
const emitNewMessage = (recipientId, bookingId, message) => {
  if (io) {
    io.to(`transporter:${recipientId}`).emit('message:new', {
      bookingId,
      message: message.toObject ? message.toObject() : message
    })
  }
}

/**
 * Emit message read event
 * @param {String} senderId - Sender transporter ID
 * @param {String} messageId - Message ID
 * @param {Date} readAt - Read timestamp
 */
const emitMessageRead = (senderId, messageId, readAt) => {
  if (io) {
    io.to(`transporter:${senderId}`).emit('message:read', {
      messageId,
      readAt
    })
  }
}

module.exports = {
  initializeSocketIO,
  getIO,
  emitTripCreated,
  emitTripCreatedForCustomer,
  emitBookingAccepted,
  emitBookingRejected,
  emitTripVehicleAssigned,
  emitTripDriverAssigned,
  emitTripAssigned,
  emitTripStarted,
  emitTripMilestoneUpdated,
  emitTripPodUploaded,
  emitTripCompleted,
  emitTripPodPending,
  emitTripClosedWithPOD,
  emitTripClosedWithoutPOD,
  emitTripAutoActivated,
  emitTripCancelled,
  emitTripUpdated,
  emitVehicleStatusUpdated,
  emitBookingRequested,
  emitPriceProposed,
  emitBookingConfirmed,
  // emitBookingRejected: emitBookingRejected,
  emitBookingCancelled,
  emitNewMessage,
  emitMessageRead
}
