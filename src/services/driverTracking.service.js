const Notification = require('../models/Notification')
const { TRACKING_UPDATE_INTERVAL_SECONDS } = require('./tripLocationLog.service')

const DRIVER_TRACKING_STATUS = Object.freeze({
  ONLINE: 'online',
  GPS_OFF: 'gps_off',
  OFFLINE: 'offline',
  LOGGED_OUT: 'logged_out',
  STALE: 'stale'
})

const DRIVER_TRACKING_STALE_SECONDS = Math.max(
  TRACKING_UPDATE_INTERVAL_SECONDS * 3,
  30
)

const DRIVER_TRACKING_STATUS_LABEL = {
  [DRIVER_TRACKING_STATUS.ONLINE]: 'online',
  [DRIVER_TRACKING_STATUS.GPS_OFF]: 'GPS turned off',
  [DRIVER_TRACKING_STATUS.OFFLINE]: 'offline',
  [DRIVER_TRACKING_STATUS.LOGGED_OUT]: 'logged out',
  [DRIVER_TRACKING_STATUS.STALE]: 'stale'
}

const DRIVER_TRACKING_PRIORITY = {
  [DRIVER_TRACKING_STATUS.ONLINE]: 'medium',
  [DRIVER_TRACKING_STATUS.GPS_OFF]: 'high',
  [DRIVER_TRACKING_STATUS.OFFLINE]: 'high',
  [DRIVER_TRACKING_STATUS.LOGGED_OUT]: 'high',
  [DRIVER_TRACKING_STATUS.STALE]: 'urgent'
}

const DRIVER_TRACKING_NOTIFICATION_TYPE = 'DRIVER_STATUS'

const isValidTrackingStatus = status =>
  Object.values(DRIVER_TRACKING_STATUS).includes(status)

const normalizeBool = value =>
  typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null

const getTrackingSnapshot = trip => trip?.driverTracking || {}

const buildTrackingReason = ({ status, socketReason, note }) => {
  if (note) {
    return note
  }

  switch (status) {
    case DRIVER_TRACKING_STATUS.GPS_OFF:
      return 'gps_disabled'
    case DRIVER_TRACKING_STATUS.LOGGED_OUT:
      return 'driver_logged_out'
    case DRIVER_TRACKING_STATUS.STALE:
      return 'heartbeat_timeout'
    case DRIVER_TRACKING_STATUS.OFFLINE:
      return socketReason ? `socket_${socketReason.replace(/\s+/g, '_')}` : 'network_lost'
    case DRIVER_TRACKING_STATUS.ONLINE:
    default:
      return 'tracking_active'
  }
}

const resolveTrackingStatusFromTelemetry = ({
  explicitStatus = null,
  loggedOut = false,
  gpsEnabled,
  networkConnected,
  socketReason = null,
  heartbeatMissed = false
} = {}) => {
  if (explicitStatus && isValidTrackingStatus(explicitStatus)) {
    return explicitStatus
  }

  if (loggedOut) {
    return DRIVER_TRACKING_STATUS.LOGGED_OUT
  }

  if (heartbeatMissed) {
    return DRIVER_TRACKING_STATUS.STALE
  }

  const gpsState = normalizeBool(gpsEnabled)
  if (gpsState === false) {
    return DRIVER_TRACKING_STATUS.GPS_OFF
  }

  const networkState = normalizeBool(networkConnected)
  if (networkState === false) {
    return DRIVER_TRACKING_STATUS.OFFLINE
  }

  if (typeof socketReason === 'string' && socketReason.trim()) {
    return DRIVER_TRACKING_STATUS.OFFLINE
  }

  return DRIVER_TRACKING_STATUS.ONLINE
}

const buildTrackingNotification = ({ trip, previousStatus, nextStatus, reason, source }) => {
  if (!trip?.transporterId) {
    return null
  }

  const changed = previousStatus !== nextStatus
  const shouldNotify =
    changed &&
    (nextStatus !== DRIVER_TRACKING_STATUS.ONLINE ||
      (previousStatus && previousStatus !== DRIVER_TRACKING_STATUS.ONLINE))

  if (!shouldNotify) {
    return null
  }

  const tripRef = trip.tripId || trip._id?.toString?.() || trip._id || 'trip'
  const label = DRIVER_TRACKING_STATUS_LABEL[nextStatus] || nextStatus
  const title =
    nextStatus === DRIVER_TRACKING_STATUS.ONLINE
      ? 'Driver back online'
      : nextStatus === DRIVER_TRACKING_STATUS.LOGGED_OUT
        ? 'Driver logged out'
        : nextStatus === DRIVER_TRACKING_STATUS.GPS_OFF
          ? 'Driver GPS turned off'
          : nextStatus === DRIVER_TRACKING_STATUS.STALE
            ? 'Driver tracking stalled'
            : 'Driver went offline'

  const message = `Trip ${tripRef}: driver status changed to ${label}${reason ? ` (${reason})` : ''}`
  const priority = DRIVER_TRACKING_PRIORITY[nextStatus] || 'medium'

  return {
    userId: trip.transporterId._id || trip.transporterId,
    userType: 'TRANSPORTER',
    type: DRIVER_TRACKING_NOTIFICATION_TYPE,
    title,
    message,
    data: {
      tripId: trip._id?.toString?.() || trip._id || null,
      publicTripId: trip.tripId || null,
      driverId: trip.driverId?._id?.toString?.() || trip.driverId?.toString?.() || trip.driverId || null,
      previousStatus,
      status: nextStatus,
      reason,
      source
    },
    priority
  }
}

const applyTrackingPatch = (trip, patch = {}) => {
  const now = patch.updatedAt || new Date()
  const previous = getTrackingSnapshot(trip)
  const current = {
    ...previous,
    ...patch,
    updatedAt: now
  }

  trip.driverTracking = current

  if (patch.location && typeof patch.location === 'object') {
    trip.lastDriverLocation = {
      ...(trip.lastDriverLocation || {}),
      ...patch.location,
      updatedAt: patch.location.updatedAt || now
    }
  }

  const changed =
    previous.status !== current.status ||
    previous.reason !== current.reason ||
    previous.source !== current.source ||
    previous.lastHeartbeatAt?.toString?.() !== current.lastHeartbeatAt?.toString?.() ||
    previous.lastLocationAt?.toString?.() !== current.lastLocationAt?.toString?.() ||
    previous.lastLogoutAt?.toString?.() !== current.lastLogoutAt?.toString?.() ||
    previous.lastDisconnectAt?.toString?.() !== current.lastDisconnectAt?.toString?.() ||
    previous.gpsEnabled !== current.gpsEnabled ||
    previous.networkConnected !== current.networkConnected ||
    previous.appState !== current.appState ||
    previous.batteryLevel !== current.batteryLevel

  return { previous, current, changed }
}

const persistTrackingUpdate = async ({
  trip,
  patch = {},
  actor = { userId: null, userType: 'SYSTEM' },
  notifyTransporter = true
}) => {
  const { previous, current, changed } = applyTrackingPatch(trip, patch)

  trip.audit = trip.audit || {}
  trip.audit.updatedBy = {
    userId: actor.userId || null,
    userType:
      typeof actor.userType === 'string' ? actor.userType.toUpperCase().replace('-', '_') : 'SYSTEM'
  }

  await trip.save()

  let notification = null
  if (notifyTransporter && changed) {
    notification = buildTrackingNotification({
      trip,
      previousStatus: previous.status || null,
      nextStatus: current.status || null,
      reason: current.reason || null,
      source: current.source || null
    })

    if (notification) {
      await Notification.create(notification)
    }
  }

  return {
    trip,
    previousTracking: previous,
    currentTracking: current,
    changed,
    notification
  }
}

const buildTrackingPayload = (trip, extra = {}) => {
  const tracking = getTrackingSnapshot(trip)
  return {
    tripId: trip?._id?.toString?.() || trip?._id || null,
    trip: trip?.toObject ? trip.toObject() : trip,
    driverId: trip?.driverId?._id?.toString?.() || trip?.driverId?.toString?.() || trip?.driverId || null,
    status: tracking.status || DRIVER_TRACKING_STATUS.OFFLINE,
    reason: tracking.reason || null,
    source: tracking.source || null,
    lastSeenAt: tracking.updatedAt || null,
    lastHeartbeatAt: tracking.lastHeartbeatAt || null,
    lastLocationAt: tracking.lastLocationAt || null,
    gpsEnabled: tracking.gpsEnabled ?? null,
    networkConnected: tracking.networkConnected ?? null,
    appState: tracking.appState || null,
    batteryLevel: tracking.batteryLevel ?? null,
    updatedAt: tracking.updatedAt || null,
    ...extra
  }
}

module.exports = {
  DRIVER_TRACKING_STATUS,
  DRIVER_TRACKING_STALE_SECONDS,
  applyTrackingPatch,
  buildTrackingPayload,
  persistTrackingUpdate,
  resolveTrackingStatusFromTelemetry
}
