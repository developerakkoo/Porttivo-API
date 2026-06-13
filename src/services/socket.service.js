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
const {
  TRACKING_UPDATE_INTERVAL_SECONDS,
  logTripLocationUpdate
} = require('./tripLocationLog.service')
const {
  DRIVER_TRACKING_STATUS,
  DRIVER_TRACKING_STALE_SECONDS,
  applyTrackingPatch,
  buildTrackingPayload,
  persistTrackingUpdate,
  resolveTrackingStatusFromTelemetry
} = require('./driverTracking.service')
const logger = require('../utils/logger')

const TransporterMessage = require('../models/TransporterMessage')
const Notification = require('../models/Notification')
const { getTransporterActorId } = require('../utils/transporterActor')
const { buildChatMessageSocketPayload } = require('../utils/marketplaceChatPayload')
const {
  buildMarketplaceMessageNotificationFields
} = require('../utils/marketplaceNotification')
const {
  MAX_CHAT_ATTACHMENTS,
  normalizeAttachmentsInput,
  bookingAllowsParticipantChat,
  effectiveChatMessageType
} = require('../utils/marketplaceChatAttachments')
const { canTransporterPartyViewTripExecution } = require('./tripAccess.service')
const SupportTicket = require('../models/SupportTicket')
const supportTicketService = require('./supportTicket.service')
const env = require('../config/env')
let io = null
let staleDriverTrackingTimer = null

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

/** Distinct codes for marketplace chat `error` events (client logging / support). */
function emitMarketplaceChatError(socket, code, message) {
  socket.emit('error', { code, message })
}

const safeSocketMeta = socket => {
  const transport = socket.conn?.transport?.name || null
  const xf = socket.handshake.headers['x-forwarded-for']
  const clientIp =
    (typeof xf === 'string' && xf.split(',')[0]?.trim()) ||
    socket.handshake.address ||
    null
  const ua = socket.handshake.headers['user-agent']

  return {
    socketId: socket.id,
    userType: socket.user?.userType || null,
    userId: socket.user?.id || null,
    transporterScopeId: socket.user ? getTransporterScopeId(socket.user) : null,
    transport,
    clientIp,
    userAgent: ua ? String(ua).slice(0, 160) : null
  }
}

const describeSocketEvent = (event, details = {}) => {
  const parts = [event]

  if (details.phase) {
    parts.push(details.phase)
  }

  if (details.result) {
    parts.push(details.result)
  }

  if (details.reason) {
    parts.push(details.reason)
  }

  if (details.room) {
    parts.push(`room=${details.room}`)
  }

  if (details.tripId) {
    parts.push(`tripId=${details.tripId}`)
  }

  if (details.bookingId) {
    parts.push(`bookingId=${details.bookingId}`)
  }

  if (details.vehicleId) {
    parts.push(`vehicleId=${details.vehicleId}`)
  }

  if (details.message) {
    parts.push(details.message)
  }

  return parts.join(' - ')
}

const logSocketEvent = (event, socket, details = {}, level = 'log') => {
  const payload = {
    ...safeSocketMeta(socket)
  }
  const logFn = level === 'error' ? logger.error : level === 'warn' ? logger.warn : logger.info
  logFn(describeSocketEvent(event, details), payload)
}

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
  logger.info(`socket ${event}`, row)
}

const emitToTripAudience = (eventName, payload, options = {}) => {
  if (!io || !payload?.trip) {
    return
  }

  const trip = payload.trip
  const recipientRooms = []

  if (trip.transporterId) {
    const room = `transporter:${trip.transporterId._id || trip.transporterId}`
    recipientRooms.push(room)
    io.to(room).emit(eventName, payload)
  }

  if (trip.driverId) {
    const room = `driver:${trip.driverId._id || trip.driverId}`
    recipientRooms.push(room)
    io.to(room).emit(eventName, payload)
  }

  if (trip.customerId && !options.excludeCustomer) {
    const room = `customer:${trip.customerId._id || trip.customerId}`
    recipientRooms.push(room)
    io.to(room).emit(eventName, payload)
  }

  const vehicleRoom = getTripVehicleRoom(trip)
  if (vehicleRoom) {
    recipientRooms.push(vehicleRoom)
    io.to(vehicleRoom).emit(eventName, payload)
  }

  const tripRoom = `trip:${trip._id || trip.id}`
  recipientRooms.push(tripRoom)
  io.to(tripRoom).emit(eventName, payload)

  // Admin receives all trip events
  recipientRooms.push('admin:all')
  io.to('admin:all').emit(eventName, payload)

  logger.info(`broadcast ${eventName}`, {
    tripId: trip._id || trip.id,
    recipients: recipientRooms.join(', ')
  })
}

const emitDriverTrackingChanged = (trip, extra = {}) => {
  if (!trip) {
    return
  }

  emitToTripAudience('driver:status:changed', buildTrackingPayload(trip, extra))
}

const setTripDriverTrackingOnline = (trip, source, extra = {}) => {
  const now = extra.updatedAt || new Date()
  applyTrackingPatch(trip, {
    status: DRIVER_TRACKING_STATUS.ONLINE,
    reason: extra.reason || 'tracking_active',
    source,
    updatedAt: now,
    lastHeartbeatAt: extra.lastHeartbeatAt || now,
    lastLocationAt: extra.lastLocationAt || trip.driverTracking?.lastLocationAt || null,
    gpsEnabled: extra.gpsEnabled ?? trip.driverTracking?.gpsEnabled ?? null,
    networkConnected: extra.networkConnected ?? trip.driverTracking?.networkConnected ?? null,
    appState: extra.appState ?? trip.driverTracking?.appState ?? null,
    batteryLevel: extra.batteryLevel ?? trip.driverTracking?.batteryLevel ?? null
  })
}

const buildSocketDisconnectTrackingStatus = reason =>
  resolveTrackingStatusFromTelemetry({
    socketReason: reason
  })

const sweepDriverTrackingStaleTrips = async () => {
  if (!io) {
    return
  }

  const threshold = new Date(Date.now() - DRIVER_TRACKING_STALE_SECONDS * 1000)
  const staleTrips = await Trip.find({
    status: TRIP_STATUS.ACTIVE,
    driverId: { $ne: null },
    'driverTracking.status': {
      $in: [
        DRIVER_TRACKING_STATUS.ONLINE,
        DRIVER_TRACKING_STATUS.GPS_OFF,
        DRIVER_TRACKING_STATUS.OFFLINE
      ]
    },
    'driverTracking.updatedAt': {
      $lt: threshold
    }
  })
    .populate('transporterId', 'name company mobile')
    .populate('driverId', 'name mobile')
    .populate('customerId', 'name mobile')
    .populate('vehicleId', 'vehicleNumber trailerType')

  for (const trip of staleTrips) {
    const { previousTracking, currentTracking, changed } = await persistTrackingUpdate({
      trip,
      patch: {
        status: DRIVER_TRACKING_STATUS.STALE,
        reason: 'heartbeat_timeout',
        source: 'stale-monitor',
        updatedAt: new Date()
      },
      actor: {
        userId: null,
        userType: 'system'
      }
    })

    if (changed) {
      emitDriverTrackingChanged(trip, {
        previousStatus: previousTracking.status || null,
        status: currentTracking.status,
        reason: currentTracking.reason,
        source: currentTracking.source,
        lastSeenAt: currentTracking.updatedAt,
        lastHeartbeatAt: currentTracking.lastHeartbeatAt,
        lastLocationAt: currentTracking.lastLocationAt,
        gpsEnabled: currentTracking.gpsEnabled ?? null,
        networkConnected: currentTracking.networkConnected ?? null,
        appState: currentTracking.appState || null,
        batteryLevel: currentTracking.batteryLevel ?? null,
        updatedAt: currentTracking.updatedAt
      })
    }
  }
}

const startDriverTrackingStaleMonitor = () => {
  if (staleDriverTrackingTimer) {
    return
  }

  staleDriverTrackingTimer = setInterval(() => {
    sweepDriverTrackingStaleTrips().catch(error => {
      logger.error('driver tracking stale sweep failed', {
        message: error.message
      })
    })
  }, Math.max(TRACKING_UPDATE_INTERVAL_SECONDS * 1000 * 2, 30000))

  if (typeof staleDriverTrackingTimer.unref === 'function') {
    staleDriverTrackingTimer.unref()
  }
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

  startDriverTrackingStaleMonitor()

  // Authentication middleware for Socket.IO
  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth.token ||
        socket.handshake.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        logger.warn('socket authentication failed', {
          reason: 'no_token',
          socketId: socket.id,
          clientIp:
            socket.handshake.address ||
            socket.handshake.headers['x-forwarded-for'] ||
            null
        })
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
          logger.warn('socket authentication failed', {
            reason: 'user_not_found',
            socketId: socket.id,
            userType: decoded.userType,
            userId: decoded.userId
          })
          return next(new Error('Authentication error: User not found'))
        }

        if (user.status === 'blocked' || user.status === 'inactive') {
          logger.warn('socket authentication failed', {
            reason: 'account_inactive',
            socketId: socket.id,
            userType: decoded.userType,
            userId: decoded.userId,
            status: user.status
          })
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
        logger.warn('socket authentication failed', {
          reason: 'invalid_token',
          socketId: socket.id,
          message: tokenError.message
        })
        return next(new Error(`Authentication error: ${tokenError.message}`))
      }
    } catch (error) {
      logger.error('socket authentication failed', {
        reason: 'unexpected_error',
        socketId: socket.id,
        message: error.message
      })
      next(new Error(`Authentication error: ${error.message}`))
    }
  })

  // Connection handler
  io.on('connection', socket => {
    console.log(
      `Socket connected: ${socket.id} (${socket.user.userType}: ${socket.user.id})`
    )
    logSocketEvent('connected', socket, {
      rooms: Array.from(socket.rooms || [])
    })

    // Join user-specific rooms
    if (socket.user.userType === 'transporter') {
      socket.join(`transporter:${socket.user.id}`)
      // 🔥 USER ONLINE EVENT
      const transporterScopeId = getTransporterScopeId(socket.user)
      if (transporterScopeId) {
        io.to(`transporter:${transporterScopeId}`).emit('user:online', {
          userId: transporterScopeId
        })
        logSocketEvent('user:online', socket, {
          room: `transporter:${transporterScopeId}`,
          result: 'emitted'
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
        logSocketEvent('join:transporter', socket, {
          room: `transporter:${id}`,
          result: 'joined'
        })
      } else if (
        socket.user.userType === 'company-user' &&
        socket.user.transporterId === id
      ) {
        socket.join(`transporter:${id}`)
        console.log(
          `Socket ${socket.id} joined transporter:${id} (company-user)`
        )
        logSocketEvent('join:transporter', socket, {
          room: `transporter:${id}`,
          result: 'joined',
          scope: 'company-user'
        })
      } else {
        logSocketEvent('join:transporter', socket, {
          room: `transporter:${id}`,
          result: 'denied'
        }, 'warn')
      }
    })

    socket.on('join:driver', driverId => {
      if (socket.user.userType === 'driver' && socket.user.id === driverId) {
        socket.join(`driver:${driverId}`)
        console.log(`Socket ${socket.id} joined driver:${driverId}`)
        logSocketEvent('join:driver', socket, {
          room: `driver:${driverId}`,
          result: 'joined'
        })
      } else {
        logSocketEvent('join:driver', socket, {
          room: `driver:${driverId}`,
          result: 'denied'
        }, 'warn')
      }
    })

    socket.on('join:customer', customerId => {
      if (
        socket.user.userType === 'customer' &&
        socket.user.id === customerId
      ) {
        socket.join(`customer:${customerId}`)
        console.log(`Socket ${socket.id} joined customer:${customerId}`)
        logSocketEvent('join:customer', socket, {
          room: `customer:${customerId}`,
          result: 'joined'
        })
      } else {
        logSocketEvent('join:customer', socket, {
          room: `customer:${customerId}`,
          result: 'denied'
        }, 'warn')
      }
    })

    socket.on('join:vehicle', async vehicleId => {
      try {
        const vid = vehicleId?.toString?.() ?? vehicleId
        if (!vid) return
        logSocketEvent('join:vehicle', socket, { vehicleId: vid, phase: 'attempt' })

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
        logSocketEvent('join:vehicle', socket, {
          vehicleId: vid,
          result: 'joined'
        })
      } catch (err) {
        console.error('join:vehicle error', err)
        logSocketEvent('join:vehicle', socket, {
          result: 'error',
          message: err.message
        }, 'error')
      }
    })

    socket.on('join:trip', async tripId => {
      try {
        const tid = tripId?.toString?.() ?? tripId
        if (!tid) return
        logSocketEvent('join:trip', socket, { tripId: tid, phase: 'attempt' })

        const trip = await Trip.findById(tid).select(
          'transporterId driverId customerId bookingId isFromBooking'
        )
        if (!trip) {
          console.warn(`Socket ${socket.id} join:trip denied — trip not found`)
          return
        }

        const ut = socket.user.userType
        if (ut === 'admin') {
          socket.join(`trip:${tid}`)
          console.log(`Socket ${socket.id} joined trip:${tid} (admin)`)
          logSocketEvent('join:trip', socket, {
            tripId: tid,
            result: 'joined',
            scope: 'admin'
          })
          return
        }

        if (ut === 'driver') {
          if (trip.driverId && trip.driverId.toString() === socket.user.id) {
            socket.join(`trip:${tid}`)
            console.log(`Socket ${socket.id} joined trip:${tid} (driver)`)
            logSocketEvent('join:trip', socket, {
              tripId: tid,
              result: 'joined',
              scope: 'driver'
            })
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
            logSocketEvent('join:trip', socket, {
              tripId: tid,
              result: 'joined',
              scope: 'customer'
            })
          }
          return
        }

        if (ut === 'transporter' || ut === 'company-user') {
          if (await canTransporterPartyViewTripExecution(socket.user, trip)) {
            socket.join(`trip:${tid}`)
            console.log(`Socket ${socket.id} joined trip:${tid}`)
            logSocketEvent('join:trip', socket, {
              tripId: tid,
              result: 'joined'
            })
          } else {
            console.warn(
              `Socket ${socket.id} join:trip denied — not a party on this trip`
            )
          }
          return
        }

        console.warn(`Socket ${socket.id} join:trip denied — unsupported user type`)
      } catch (err) {
        console.error('join:trip error', err)
        logSocketEvent('join:trip', socket, {
          result: 'error',
          message: err.message
        }, 'error')
      }
    })

    // Handle trip start (from driver app)
    socket.on('trip:start', async data => {
      try {
        const { tripId } = data
        logSocketEvent('trip:start', socket, { tripId, phase: 'attempt' })

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
        setTripDriverTrackingOnline(trip, 'socket.trip.start', {
          reason: 'trip_started',
          lastHeartbeatAt: new Date()
        })
        await trip.save()
        logSocketEvent('trip:start', socket, {
          tripId: trip._id.toString(),
          tripCode: trip.tripId || null,
          result: 'success',
          status: trip.status
        })

        console.log(
          '[Trip/start]',
          JSON.stringify({
            tripId: trip.tripId,
            tripObjectId: trip._id.toString(),
            driverId: socket.user.id,
            userType: socket.user.userType,
            status: trip.status,
            trackingUpdateIntervalSeconds: TRACKING_UPDATE_INTERVAL_SECONDS
          })
        )

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
            : null,
          trackingConfig: {
            updateIntervalSeconds: TRACKING_UPDATE_INTERVAL_SECONDS
          }
        }
        emitToTripAudience('trip:started', startedPayload)
      } catch (error) {
        console.error('Error handling trip:start:', error)
        logSocketEvent('trip:start', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to start trip'
        })
      }
    })

    // Handle trip pause (from driver or transporter)
    socket.on('trip:pause', async data => {
      try {
        const { tripId } = data
        logSocketEvent('trip:pause', socket, { tripId, phase: 'attempt' })

        if (!tripId) {
          return socket.emit('error', { message: 'Trip ID is required' })
        }

        if (socket.user.userType !== 'driver' && socket.user.userType !== 'transporter') {
          return socket.emit('error', {
            message: 'Only drivers and transporters can pause trips'
          })
        }

        const trip = await Trip.findById(tripId)
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' })
        }

        if (socket.user.userType === 'driver') {
          if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
            return socket.emit('error', {
              message: 'Access denied. This trip is not assigned to you.'
            })
          }
        } else if (!trip.transporterId || trip.transporterId.toString() !== socket.user.id) {
          return socket.emit('error', {
            message: 'Access denied. You do not have permission to pause this trip.'
          })
        }

        if (trip.status === TRIP_STATUS.PAUSED) {
          return socket.emit('trip:paused', {
            trip: trip.toObject()
          })
        }

        if (trip.status !== TRIP_STATUS.ACTIVE) {
          return socket.emit('error', {
            message: `Trip can only be paused from ACTIVE status. Current status: ${trip.status}`
          })
        }

        trip.status = TRIP_STATUS.PAUSED
        trip.audit.updatedBy = {
          userId: socket.user.id,
          userType: toAuditUserType(socket.user.userType)
        }
        await trip.save()
        logSocketEvent('trip:pause', socket, {
          tripId: trip._id.toString(),
          result: 'success',
          status: trip.status
        })

        const currentMilestone = trip.getCurrentMilestone()
        const milestoneLabel = currentMilestone
          ? getDriverLabel(currentMilestone.milestoneType)
          : null

        emitTripPaused(
          trip,
          currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel
              }
            : null
        )
        emitTripUpdated(trip, { reason: 'trip_paused', changedFields: ['status'] })
      } catch (error) {
        console.error('Error handling trip:pause:', error)
        logSocketEvent('trip:pause', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to pause trip'
        })
      }
    })

    // Handle trip resume (from driver or transporter)
    socket.on('trip:resume', async data => {
      try {
        const { tripId } = data
        logSocketEvent('trip:resume', socket, { tripId, phase: 'attempt' })

        if (!tripId) {
          return socket.emit('error', { message: 'Trip ID is required' })
        }

        if (socket.user.userType !== 'driver' && socket.user.userType !== 'transporter') {
          return socket.emit('error', {
            message: 'Only drivers and transporters can resume trips'
          })
        }

        const trip = await Trip.findById(tripId)
        if (!trip) {
          return socket.emit('error', { message: 'Trip not found' })
        }

        if (socket.user.userType === 'driver') {
          if (!trip.driverId || trip.driverId.toString() !== socket.user.id) {
            return socket.emit('error', {
              message: 'Access denied. This trip is not assigned to you.'
            })
          }
        } else if (!trip.transporterId || trip.transporterId.toString() !== socket.user.id) {
          return socket.emit('error', {
            message: 'Access denied. You do not have permission to resume this trip.'
          })
        }

        if (trip.status === TRIP_STATUS.ACTIVE) {
          return socket.emit('trip:resumed', {
            trip: trip.toObject()
          })
        }

        if (trip.status !== TRIP_STATUS.PAUSED) {
          return socket.emit('error', {
            message: `Trip can only be resumed from PAUSED status. Current status: ${trip.status}`
          })
        }

        trip.status = TRIP_STATUS.ACTIVE
        trip.audit.updatedBy = {
          userId: socket.user.id,
          userType: toAuditUserType(socket.user.userType)
        }
        await trip.save()
        logSocketEvent('trip:resume', socket, {
          tripId: trip._id.toString(),
          result: 'success',
          status: trip.status
        })

        const currentMilestone = trip.getCurrentMilestone()
        const milestoneLabel = currentMilestone
          ? getDriverLabel(currentMilestone.milestoneType)
          : null

        emitTripResumed(
          trip,
          currentMilestone
            ? {
                milestoneNumber: currentMilestone.milestoneNumber,
                milestoneType: currentMilestone.milestoneType,
                label: milestoneLabel
              }
            : null
        )
        emitTripUpdated(trip, { reason: 'trip_resumed', changedFields: ['status'] })
      } catch (error) {
        console.error('Error handling trip:resume:', error)
        logSocketEvent('trip:resume', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to resume trip'
        })
      }
    })

    // Handle milestone update (from driver app)
    socket.on('trip:milestone:update', async data => {
      try {
        const { tripId, milestoneNumber, latitude, longitude, photo } = data
        logSocketEvent('trip:milestone:update', socket, {
          tripId,
          milestoneNumber,
          phase: 'attempt'
        })

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
          const statusMessage =
            trip.status === TRIP_STATUS.PAUSED
              ? 'Trip is paused. Resume the trip before updating milestones.'
              : `Milestones can only be updated for ACTIVE trips. Current status: ${trip.status}`
          return socket.emit('error', {
            message: statusMessage
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
        logTripLocationUpdate({
          trip,
          driverId: socket.user.id,
          latitude,
          longitude,
          socket,
          source: 'trip:milestone:update',
          payload: {
            tripId,
            milestoneNumber: milestoneNum,
            milestoneType,
            backendMeaning
          }
        })
        logSocketEvent('trip:milestone:update', socket, {
          tripId: trip._id.toString(),
          milestoneNumber: milestoneNum,
          milestoneType,
          backendMeaning,
          result: 'success'
        })

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
        logSocketEvent('trip:milestone:update', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to update milestone'
        })
      }
    })

    // Handle driver location update (from driver app, for real-time tracking)
    socket.on('driver:location:update', async data => {
      try {
        const {
          tripId,
          latitude,
          longitude,
          accuracy = null,
          speed = null,
          heading = null
        } = data
        logSocketEvent('driver:location:update', socket, {
          tripId,
          phase: 'attempt'
        })

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

        const previousDriverTrackingStatus = trip.driverTracking?.status || null
        trip.lastDriverLocation = {
          latitude: lat,
          longitude: lng,
          updatedAt: new Date()
        }
        setTripDriverTrackingOnline(trip, 'driver.location.update', {
          reason: 'location_update',
          lastHeartbeatAt: new Date(),
          lastLocationAt: new Date(),
          updatedAt: new Date()
        })
        await trip.save()
        logTripLocationUpdate({
          trip,
          driverId: socket.user.id,
          latitude: lat,
          longitude: lng,
          socket,
          accuracy: accuracy !== null && accuracy !== undefined ? Number(accuracy) : null,
          speed: speed !== null && speed !== undefined ? Number(speed) : null,
          heading: heading !== null && heading !== undefined ? Number(heading) : null,
          source: 'driver:location:update',
          payload: {
            tripId,
            accuracy,
            speed,
            heading
          }
        })
        logSocketEvent('driver:location:update', socket, {
          tripId: trip._id.toString(),
          result: 'success',
          latitude: lat,
          longitude: lng
        })

        const payload = {
          tripId: trip._id.toString(),
          trip: trip.toObject(),
          latitude: lat,
          longitude: lng,
          accuracy: accuracy !== null && accuracy !== undefined ? Number(accuracy) : null,
          speed: speed !== null && speed !== undefined ? Number(speed) : null,
          heading: heading !== null && heading !== undefined ? Number(heading) : null,
          timestamp: new Date().toISOString()
        }

        if (previousDriverTrackingStatus !== DRIVER_TRACKING_STATUS.ONLINE) {
          emitDriverTrackingChanged(trip, {
            previousStatus: previousDriverTrackingStatus,
            status: trip.driverTracking?.status || DRIVER_TRACKING_STATUS.ONLINE,
            reason: trip.driverTracking?.reason || 'location_update',
            source: trip.driverTracking?.source || 'driver.location.update',
            lastSeenAt: trip.driverTracking?.updatedAt || new Date(),
            lastHeartbeatAt: trip.driverTracking?.lastHeartbeatAt || new Date(),
            lastLocationAt: trip.driverTracking?.lastLocationAt || new Date(),
            gpsEnabled: trip.driverTracking?.gpsEnabled ?? null,
            networkConnected: trip.driverTracking?.networkConnected ?? null,
            appState: trip.driverTracking?.appState || null,
            batteryLevel: trip.driverTracking?.batteryLevel ?? null
          })
        }

        emitToTripAudience('driver:location:updated', payload)
      } catch (error) {
        console.error('Error handling driver:location:update:', error)
        logSocketEvent('driver:location:update', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to update location'
        })
      }
    })

    // Handle driver heartbeat / health update (GPS + connectivity status)
    socket.on('driver:health:heartbeat', async data => {
      try {
        const {
          tripId,
          gpsEnabled,
          networkConnected,
          appState = null,
          batteryLevel = null
        } = data || {}

        logSocketEvent('driver:health:heartbeat', socket, {
          tripId,
          phase: 'attempt'
        })

        if (!tripId) {
          return socket.emit('error', { message: 'Trip ID is required' })
        }

        if (socket.user.userType !== 'driver') {
          return socket.emit('error', {
            message: 'Only drivers can send heartbeat updates'
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
            message: `Heartbeat updates only allowed for ACTIVE trips. Current status: ${trip.status}`
          })
        }

        const previousDriverTrackingStatus = trip.driverTracking?.status || null
        const status = resolveTrackingStatusFromTelemetry({
          gpsEnabled,
          networkConnected
        })

        setTripDriverTrackingOnline(trip, 'driver.health.heartbeat', {
          reason:
            status === DRIVER_TRACKING_STATUS.GPS_OFF
              ? 'gps_disabled'
              : status === DRIVER_TRACKING_STATUS.OFFLINE
                ? 'network_lost'
                : 'heartbeat_received',
          gpsEnabled: gpsEnabled ?? null,
          networkConnected: networkConnected ?? null,
          appState,
          batteryLevel,
          lastHeartbeatAt: new Date(),
          updatedAt: new Date()
        })

        if (status !== DRIVER_TRACKING_STATUS.ONLINE) {
          trip.driverTracking.status = status
          trip.driverTracking.reason =
            status === DRIVER_TRACKING_STATUS.GPS_OFF
              ? 'gps_disabled'
              : 'network_lost'
        }

        trip.driverTracking.gpsEnabled =
          typeof gpsEnabled === 'boolean' ? gpsEnabled : trip.driverTracking.gpsEnabled
        trip.driverTracking.networkConnected =
          typeof networkConnected === 'boolean'
            ? networkConnected
            : trip.driverTracking.networkConnected
        trip.driverTracking.appState = appState || trip.driverTracking.appState || null
        trip.driverTracking.batteryLevel =
          batteryLevel !== null && batteryLevel !== undefined
            ? Number(batteryLevel)
            : trip.driverTracking.batteryLevel

        await trip.save()

        if (previousDriverTrackingStatus !== trip.driverTracking.status) {
          emitDriverTrackingChanged(trip, {
            previousStatus: previousDriverTrackingStatus,
            status: trip.driverTracking.status,
            reason: trip.driverTracking.reason,
            source: trip.driverTracking.source,
            lastSeenAt: trip.driverTracking.updatedAt,
            lastHeartbeatAt: trip.driverTracking.lastHeartbeatAt,
            lastLocationAt: trip.driverTracking.lastLocationAt,
            gpsEnabled: trip.driverTracking.gpsEnabled ?? null,
            networkConnected: trip.driverTracking.networkConnected ?? null,
            appState: trip.driverTracking.appState || null,
            batteryLevel: trip.driverTracking.batteryLevel ?? null
          })
        }

        logSocketEvent('driver:health:heartbeat', socket, {
          tripId: trip._id.toString(),
          result: 'success',
          status: trip.driverTracking.status,
          gpsEnabled: trip.driverTracking.gpsEnabled,
          networkConnected: trip.driverTracking.networkConnected
        })
      } catch (error) {
        console.error('Error handling driver:health:heartbeat:', error)
        logSocketEvent('driver:health:heartbeat', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to process heartbeat'
        })
      }
    })

    // Handle explicit driver logout from the app
    socket.on('driver:session:logout', async data => {
      try {
        const { tripId = null } = data || {}
        logSocketEvent('driver:session:logout', socket, {
          tripId,
          phase: 'attempt'
        })

        if (socket.user.userType !== 'driver') {
          return socket.emit('error', {
            message: 'Only drivers can log out from the driver app'
          })
        }

        const trip =
          tripId
            ? await Trip.findById(tripId)
            : await Trip.findOne({
                driverId: socket.user.id,
                status: TRIP_STATUS.ACTIVE
              })

        if (trip && trip.driverId && trip.driverId.toString() === socket.user.id) {
          const { previousTracking, currentTracking } = await persistTrackingUpdate({
            trip,
            patch: {
              status: DRIVER_TRACKING_STATUS.LOGGED_OUT,
              reason: 'driver_requested_logout',
              source: 'socket.driver.session.logout',
              lastLogoutAt: new Date(),
              updatedAt: new Date()
            },
            actor: {
              userId: socket.user.id,
              userType: socket.user.userType
            }
          })

          emitDriverTrackingChanged(trip, {
            previousStatus: previousTracking.status || null,
            status: currentTracking.status,
            reason: currentTracking.reason,
            source: currentTracking.source,
            lastSeenAt: currentTracking.updatedAt,
            lastHeartbeatAt: currentTracking.lastHeartbeatAt,
            lastLocationAt: currentTracking.lastLocationAt,
            gpsEnabled: currentTracking.gpsEnabled ?? null,
            networkConnected: currentTracking.networkConnected ?? null,
            appState: currentTracking.appState || null,
            batteryLevel: currentTracking.batteryLevel ?? null,
            updatedAt: currentTracking.updatedAt
          })
        }

        const driver = await Driver.findById(socket.user.id)
        if (driver) {
          driver.lastSeen = new Date()
          await driver.save({ validateBeforeSave: false })
        }

        socket.emit('driver:session:logged-out', {
          tripId: trip?._id?.toString?.() || tripId || null
        })
      } catch (error) {
        console.error('Error handling driver:session:logout:', error)
        logSocketEvent('driver:session:logout', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to log out driver session'
        })
      }
    })

    // Handle trip complete (from driver app)
    socket.on('trip:complete', async data => {
      try {
        const { tripId } = data
        logSocketEvent('trip:complete', socket, { tripId, phase: 'attempt' })

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
        logSocketEvent('trip:complete', socket, {
          tripId: trip._id.toString(),
          result: 'success',
          status: trip.status,
          podDueAt: trip.podDueAt || null
        })

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
        logSocketEvent('trip:complete', socket, {
          result: 'error',
          message: error.message
        }, 'error')
        socket.emit('error', {
          message: error.message || 'Failed to complete trip'
        })
      }
    })
    // ================= CHAT JOIN =================
    socket.on('chat:join', async ({ bookingId }) => {
      try {
        logSocketEvent('chat:join', socket, {
          bookingId,
          phase: 'attempt'
        })
        if (!bookingId) {
          return socket.emit('error', { message: 'bookingId required' })
        }

        const actorId = getTransporterScopeId(socket.user)
        if (!actorId) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_NO_ACTOR',
            'Chat requires a transporter or company-user account.'
          )
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
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_JOIN_DENIED',
            'You are not a participant in this booking.'
          )
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
        logSocketEvent('chat:join', socket, {
          bookingId,
          result: 'joined'
        })

        socket.emit('chat:joined', { bookingId })
      } catch (err) {
        logSocketEvent('chat:join', socket, {
          result: 'error',
          message: err.message
        }, 'error')
        socket.emit('error', { message: err.message })
      }
    })

    // ================= SEND MESSAGE =================
    socket.on('chat:message:send', async data => {
      try {
        const {
          bookingId,
          content,
          messageType,
          proposedPrice,
          attachments: attachmentsRaw
        } = data || {}
        logSocketEvent('chat:message:send', socket, {
          bookingId: data?.bookingId || null,
          phase: 'attempt'
        })

        const actorId = getTransporterScopeId(socket.user)
        if (!actorId) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_NO_ACTOR',
            'Chat requires a transporter or company-user account.'
          )
        }

        if (!socket.rooms.has(`chat:${bookingId}`)) {
          return socket.emit('error', {
            message: 'Join chat first before sending message'
          })
        }

        if (!bookingId) {
          return socket.emit('error', {
            message: 'bookingId required'
          })
        }

        const VehicleBooking = require('../models/VehicleBooking')

        const booking = await VehicleBooking.findById(bookingId)

        if (!booking) {
          return socket.emit('error', { message: 'Booking not found' })
        }

        if (!bookingAllowsParticipantChat(booking)) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_BOOKING_CLOSED',
            'Chat is closed for this booking.'
          )
        }

        const isAllowed =
          booking.buyerId.toString() === actorId ||
          booking.sellerId.toString() === actorId

        if (!isAllowed) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_SEND_DENIED',
            'You are not a participant in this booking.'
          )
        }

        const attachments = normalizeAttachmentsInput(attachmentsRaw)
        if (attachments.length > MAX_CHAT_ATTACHMENTS) {
          return socket.emit('error', {
            message: `At most ${MAX_CHAT_ATTACHMENTS} attachments`
          })
        }

        const contentStr = content != null ? String(content) : ''
        const contentTrim = contentStr.trim()
        if (!contentTrim && attachments.length === 0) {
          return socket.emit('error', {
            message: 'content or attachments required'
          })
        }

        if (attachments.length > 0 && contentTrim.length > 2000) {
          return socket.emit('error', { message: 'Caption too long' })
        }

        if (attachments.length === 0 && contentTrim.length > 2000) {
          return socket.emit('error', { message: 'Message too long' })
        }

        if (
          attachments.length > 0 &&
          proposedPrice != null &&
          proposedPrice !== ''
        ) {
          return socket.emit('error', {
            message: 'Attachments cannot be combined with price proposals'
          })
        }

        const receiverId =
          booking.buyerId.toString() === actorId
            ? booking.sellerId
            : booking.buyerId

        const effectiveType = effectiveChatMessageType(
          contentTrim,
          attachments,
          messageType,
          proposedPrice
        )

        const createdMsg = await TransporterMessage.create({
          bookingId,
          senderId: actorId,
          receiverId,
          content: contentTrim,
          messageType: effectiveType,
          proposedPrice: proposedPrice || null,
          status: 'DELIVERED',
          attachments
        })
        logSocketEvent('chat:message:send', socket, {
          bookingId,
          messageId: createdMsg._id?.toString?.() || null,
          messageType: effectiveType,
          attachmentsCount: attachments.length,
          result: 'success'
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
          const notif = buildMarketplaceMessageNotificationFields({
            bookingId,
            populatedMessageLean: populatedMessage,
            contentOverride: contentTrim
          })
          await Notification.create({
            userId: receiverId,
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
        logSocketEvent('chat:message:send', socket, {
          result: 'error',
          message: err.message
        }, 'error')
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
        logSocketEvent('chat:message:read', socket, {
          messageId,
          phase: 'attempt'
        })
        const actorId = getTransporterScopeId(socket.user)
        if (!actorId) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_NO_ACTOR',
            'Chat requires a transporter or company-user account.'
          )
        }

        const existing = await TransporterMessage.findById(messageId)
        if (!existing) {
          return socket.emit('error', { message: 'Message not found' })
        }
        if (existing.receiverId.toString() !== actorId) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_MARK_READ_NOT_RECEIVER',
            'Only the message recipient can mark as read.'
          )
        }

        const VehicleBooking = require('../models/VehicleBooking')
        const booking = await VehicleBooking.findById(existing.bookingId)
        if (
          !booking ||
          (booking.buyerId.toString() !== actorId &&
            booking.sellerId.toString() !== actorId)
        ) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_MARK_READ_BOOKING',
            'You cannot mark messages read for this booking.'
          )
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
        logSocketEvent('chat:message:read', socket, {
          messageId,
          bookingId: message.bookingId?.toString?.() || null,
          result: 'success'
        })
      } catch (err) {
        logSocketEvent('chat:message:read', socket, {
          result: 'error',
          message: err.message
        }, 'error')
        socket.emit('error', { message: err.message })
      }
    })

    // ================= TYPING =================
    socket.on('chat:typing', ({ bookingId }) => {
      if (!socket.rooms.has(`chat:${bookingId}`)) {
        logSocketEvent('chat:typing', socket, {
          bookingId,
          result: 'ignored',
          reason: 'chat_not_joined'
        })
        return
      }
      const actorId = getTransporterScopeId(socket.user)
      if (!actorId) {
        logSocketEvent('chat:typing', socket, {
          bookingId,
          result: 'ignored',
          reason: 'no_actor'
        })
        return
      }

      socket.to(`chat:${bookingId}`).emit('chat:typing', {
        senderId: actorId
      })
      logSocketEvent('chat:typing', socket, {
        bookingId,
        result: 'emitted'
      })
    })

    // ================= SUPPORT TICKET CHAT =================
    socket.on('support:join', async ({ ticketId }) => {
      try {
        logSocketEvent('support:join', socket, { ticketId, phase: 'attempt' })
        if (!ticketId) {
          return socket.emit('error', { message: 'ticketId required' })
        }
        const ticket = await SupportTicket.findById(ticketId)
        if (!ticket) {
          return socket.emit('error', { message: 'Ticket not found' })
        }
        const isAdmin = socket.user.userType === 'admin'
        const transporterScopeId = getTransporterScopeId(socket.user)
        const customerScopeId =
          socket.user.userType === 'customer' ? socket.user.id : null
        const requesterType = ticket.requesterType || 'transporter'
        const requesterId =
          ticket.requesterId?.toString?.() ||
          ticket.transporterId?.toString?.() ||
          null

        if (!isAdmin) {
          if (requesterType === 'customer') {
            if (!customerScopeId || requesterId !== customerScopeId) {
              return socket.emit('error', { message: 'Forbidden' })
            }
          } else if (!transporterScopeId || requesterId !== transporterScopeId) {
            return socket.emit('error', { message: 'Forbidden' })
          }
        }

        socket.join(`support:${ticketId}`)
        await supportTicketService.markDeliveredForOthers(ticket, socket.user.userType)
        const fresh = await supportTicketService.clearUnreadForViewer(
          ticket,
          socket.user.userType
        )
        if (fresh) {
          supportTicketService.broadcastTicketUpdated(io, fresh)
        }
        logSocketEvent('support:join', socket, { ticketId, result: 'joined' })
        socket.emit('support:joined', { ticketId })
      } catch (err) {
        logSocketEvent(
          'support:join',
          socket,
          { result: 'error', message: err.message },
          'error'
        )
        socket.emit('error', { message: err.message })
      }
    })

    socket.on('support:leave', ({ ticketId }) => {
      if (ticketId) socket.leave(`support:${ticketId}`)
    })

    socket.on('support:message:send', async data => {
      try {
        const { ticketId, content, attachments: attachmentsRaw } = data || {}
        logSocketEvent('support:message:send', socket, {
          ticketId,
          phase: 'attempt'
        })
        if (!ticketId) {
          return socket.emit('error', { message: 'ticketId required' })
        }
        if (!socket.rooms.has(`support:${ticketId}`)) {
          return socket.emit('error', {
            message: 'Join support thread before sending'
          })
        }

        const ticket = await SupportTicket.findById(ticketId)
        if (!ticket) {
          return socket.emit('error', { message: 'Ticket not found' })
        }

        const isAdmin = socket.user.userType === 'admin'
        const requesterType = ticket.requesterType || 'transporter'
        const requesterId =
          ticket.requesterId?.toString?.() ||
          ticket.transporterId?.toString?.() ||
          null
        const scopeId = getTransporterScopeId(socket.user)
        const customerId = socket.user.userType === 'customer' ? socket.user.id : null
        if (isAdmin) {
          await supportTicketService.appendMessage(io, ticket, {
            senderType: 'admin',
            senderId: socket.user.id,
            content,
            attachmentsRaw
          })
        } else {
          if (requesterType === 'customer') {
            if (!customerId || requesterId !== customerId) {
              return socket.emit('error', { message: 'Forbidden' })
            }
            await supportTicketService.appendMessage(io, ticket, {
              senderType: 'customer',
              senderId: customerId,
              content,
              attachmentsRaw
            })
          } else {
            if (!scopeId || requesterId !== scopeId) {
              return socket.emit('error', { message: 'Forbidden' })
            }
            await supportTicketService.appendMessage(io, ticket, {
              senderType: 'transporter',
              senderId: scopeId,
              content,
              attachmentsRaw
            })
          }
        }
        logSocketEvent('support:message:send', socket, {
          ticketId,
          result: 'success'
        })
      } catch (err) {
        logSocketEvent(
          'support:message:send',
          socket,
          { result: 'error', message: err.message },
          'error'
        )
        socket.emit('error', { message: err.message })
      }
    })

    socket.on('support:message:read', async ({ messageId }) => {
      try {
        if (!messageId) {
          return socket.emit('error', { message: 'messageId required' })
        }
        const isAdmin = socket.user.userType === 'admin'
        const reader = isAdmin
          ? { userType: 'admin', transporterScopeId: null }
          : {
              userType: socket.user.userType,
              transporterScopeId: getTransporterScopeId(socket.user),
              customerScopeId:
                socket.user.userType === 'customer'
                  ? socket.user.id
                  : null
            }
        if (!isAdmin && !reader.transporterScopeId && !reader.customerScopeId) {
          return socket.emit('error', { message: 'Forbidden' })
        }
        const { message } = await supportTicketService.markMessageRead(
          messageId,
          reader
        )
        const readPayload = {
          ticketId: message.ticketId.toString(),
          messageId: message._id.toString(),
          readAt: message.readAt
        }
        io.to(`support:${message.ticketId}`).emit(
          'support:message:read',
          readPayload
        )
      } catch (err) {
        socket.emit('error', { message: err.message })
      }
    })

    socket.on('support:typing', ({ ticketId }) => {
      if (!ticketId || !socket.rooms.has(`support:${ticketId}`)) return
      const isAdmin = socket.user.userType === 'admin'
      const scopeId = getTransporterScopeId(socket.user)
      const customerId = socket.user.userType === 'customer' ? socket.user.id : null
      if (!isAdmin && !scopeId && !customerId) return
      socket.to(`support:${ticketId}`).emit('support:typing', {
        ticketId,
        senderType: isAdmin
          ? 'admin'
          : socket.user.userType === 'customer'
            ? 'customer'
            : 'transporter'
      })
    })

    // Thread presence (peer opened / closed this chat screen)
    socket.on('chat:thread:join', async ({ bookingId }) => {
      try {
        logSocketEvent('chat:thread:join', socket, {
          bookingId,
          phase: 'attempt'
        })
        const actorId = getTransporterScopeId(socket.user)
        if (!actorId) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_NO_ACTOR',
            'Chat requires a transporter or company-user account.'
          )
        }
        if (!bookingId) {
          return socket.emit('error', { message: 'bookingId required' })
        }
        const VehicleBooking = require('../models/VehicleBooking')
        const booking = await VehicleBooking.findById(bookingId)
        if (!booking) {
          return socket.emit('error', { message: 'Booking not found' })
        }
        const allowed =
          booking.buyerId.toString() === actorId ||
          booking.sellerId.toString() === actorId
        if (!allowed) {
          return emitMarketplaceChatError(
            socket,
            'MP_CHAT_THREAD_JOIN_DENIED',
            'You are not a participant in this booking.'
          )
        }
        if (!socket.rooms.has(`chat:${bookingId}`)) {
          socket.join(`chat:${bookingId}`)
        }
        socket.to(`chat:${bookingId}`).emit('chat:peer:presence', {
          bookingId: bookingId.toString(),
          userId: actorId,
          state: 'active'
        })
        logSocketEvent('chat:thread:join', socket, {
          bookingId,
          result: 'emitted'
        })
      } catch (e) {
        logSocketEvent('chat:thread:join', socket, {
          result: 'error',
          message: e.message
        }, 'error')
        socket.emit('error', { message: e.message })
      }
    })

    socket.on('chat:thread:leave', ({ bookingId }) => {
      try {
        logSocketEvent('chat:thread:leave', socket, {
          bookingId,
          phase: 'attempt'
        })
        const actorId = getTransporterScopeId(socket.user)
        if (!actorId || !bookingId) return
        if (!socket.rooms.has(`chat:${bookingId}`)) return
        socket.to(`chat:${bookingId}`).emit('chat:peer:presence', {
          bookingId: bookingId.toString(),
          userId: actorId,
          state: 'away'
        })
        logSocketEvent('chat:thread:leave', socket, {
          bookingId,
          result: 'emitted'
        })
      } catch (e) {
        logSocketEvent('chat:thread:leave', socket, {
          result: 'error',
          message: e.message
        }, 'error')
        socket.emit('error', { message: e.message })
      }
    })

    socket.on('chat:leave', ({ bookingId }) => {
      socket.leave(`chat:${bookingId}`)
      const actorId = getTransporterScopeId(socket.user)

      socket.to(`chat:${bookingId}`).emit('chat:user:left', {
        userId: actorId || socket.user.id
      })
      logSocketEvent('chat:leave', socket, {
        bookingId,
        result: 'left'
      })
    })

    socket.on('disconnecting', () => {
      const actorId = getTransporterScopeId(socket.user)
      if (!actorId) return
      logSocketEvent('disconnecting', socket, {
        rooms: Array.from(socket.rooms || [])
      })
      for (const room of socket.rooms) {
        if (room.startsWith('chat:')) {
          const bookingId = room.slice('chat:'.length)
          socket.to(room).emit('chat:peer:presence', {
            bookingId,
            userId: actorId,
            state: 'away'
          })
        }
      }
    })

    // Disconnection handler
    socket.on('disconnect', reason => {
      logger.info('Socket disconnected', { socketId: socket.id, reason })
      logSocketEvent('disconnect', socket, {
        reason: reason || null
      })
      logTransporterSocketLifecycle('disconnected', socket, {
        reason: reason || null
      })
      // 🔥 USER OFFLINE EVENT
      const transporterScopeId = getTransporterScopeId(socket.user)
      if (transporterScopeId) {
        io.to(`transporter:${transporterScopeId}`).emit('user:offline', {
          userId: transporterScopeId
        })
        logSocketEvent('user:offline', socket, {
          room: `transporter:${transporterScopeId}`,
          result: 'emitted'
        })
      }

      if (socket.user.userType === 'driver') {
        const driverId = socket.user.id
        Trip.findOne({
          driverId,
          status: TRIP_STATUS.ACTIVE
        })
          .then(async trip => {
            if (!trip) {
              return
            }

            const { previousTracking, currentTracking } = await persistTrackingUpdate({
              trip,
              patch: {
                status: buildSocketDisconnectTrackingStatus(reason),
                reason: reason ? `socket_${reason.replace(/\s+/g, '_')}` : 'socket_disconnect',
                source: 'socket.disconnect',
                lastDisconnectAt: new Date(),
                updatedAt: new Date()
              },
              actor: {
                userId: driverId,
                userType: 'driver'
              }
            })

            emitDriverTrackingChanged(trip, {
              previousStatus: previousTracking.status || null,
              status: currentTracking.status,
              reason: currentTracking.reason,
              source: currentTracking.source,
              lastSeenAt: currentTracking.updatedAt,
              lastHeartbeatAt: currentTracking.lastHeartbeatAt,
              lastLocationAt: currentTracking.lastLocationAt,
              gpsEnabled: currentTracking.gpsEnabled ?? null,
              networkConnected: currentTracking.networkConnected ?? null,
              appState: currentTracking.appState || null,
              batteryLevel: currentTracking.batteryLevel ?? null,
              updatedAt: currentTracking.updatedAt
            })
          })
          .catch(error => {
            logger.error('driver disconnect tracking update failed', {
              message: error.message,
              socketId: socket.id,
              driverId
            })
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
    logger.info('broadcast trip:created', {
      recipient: `transporter:${transporterId}`,
      tripId: trip?._id?.toString?.() || trip?.id || null
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
    logger.info('broadcast trip:created', {
      recipient: `customer:${customerId}`,
      tripId: trip?._id?.toString?.() || trip?.id || null
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
    logger.info('broadcast trip:customer:rejected', {
      recipient: `customer:${tripData.customerId._id || tripData.customerId}`,
      tripId: tripData._id || tripData.id || null
    })
  }
  io.to(`transporter:${transporterId}`).emit('trip:customer:rejected', {
    tripId: tripData._id || tripData.id
  })
  logger.info('broadcast trip:customer:rejected', {
    recipient: `transporter:${transporterId}`,
    tripId: tripData._id || tripData.id || null
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

const emitTripStarted = (trip, currentMilestone = null, meta = {}) => {
  emitToTripAudience('trip:started', {
    trip: trip.toObject ? trip.toObject() : trip,
    currentMilestone,
    ...(meta.trackingConfig ? { trackingConfig: meta.trackingConfig } : {})
  })
}

const emitTripPaused = (trip, currentMilestone = null) => {
  emitToTripAudience('trip:paused', {
    trip: trip.toObject ? trip.toObject() : trip,
    currentMilestone
  })
}

const emitTripResumed = (trip, currentMilestone = null) => {
  emitToTripAudience('trip:resumed', {
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

const emitTripPodApproved = (trip, meta = {}) => {
  emitToTripAudience('trip:pod:approved', {
    trip: trip.toObject ? trip.toObject() : trip,
    message: meta.message || 'POD approved successfully.',
    approvedAt: meta.approvedAt || trip?.POD?.approvedAt || null,
    closedReason: meta.closedReason || trip?.closedReason || null
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
    logger.info('broadcast vehicle:status:updated', {
      recipients: [`vehicle:${vehicleId}`, `transporter:${transporterId}`].join(', '),
      vehicleId
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
    logger.info('broadcast booking:requested', {
      recipient: `transporter:${sellerId}`,
      bookingId: booking?._id?.toString?.() || booking?.id || null
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
    logger.info('broadcast booking:price-proposed', {
      recipient: `transporter:${recipientId}`,
      bookingId: booking?._id?.toString?.() || booking?.id || null
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
    logger.info('broadcast booking:confirmed', {
      recipients: [`transporter:${buyerId}`, `transporter:${sellerId}`].join(', '),
      bookingId: booking?._id?.toString?.() || booking?.id || null
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
    logger.info('broadcast booking:cancelled', {
      recipient: `transporter:${sellerId}`,
      bookingId: booking?._id?.toString?.() || booking?.id || null
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
    logger.info('broadcast message:new', {
      recipient: `transporter:${recipientId}`,
      bookingId,
      messageId: message?._id?.toString?.() || message?.id || null
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
    logger.info('broadcast message:read', {
      recipient: `transporter:${senderId}`,
      messageId
    })
  }
}

const emitVehicleTypeRequestUpdated = (transporterId, requestPayload) => {
  if (!io || !transporterId) return
  io.to(`transporter:${transporterId}`).emit('vehicle-type:request:updated', {
    request: requestPayload,
  })
  logger.info('broadcast vehicle-type:request:updated', {
    recipient: `transporter:${transporterId}`,
    requestId: requestPayload?.id,
    status: requestPayload?.status,
  })
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
  emitTripPaused,
  emitTripResumed,
  emitTripMilestoneUpdated,
  emitDriverTrackingChanged,
  emitTripPodUploaded,
  emitTripPodApproved,
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
  emitMessageRead,
  emitVehicleTypeRequestUpdated,
}
