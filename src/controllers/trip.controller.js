const Trip = require('../models/Trip')
const Vehicle = require('../models/Vehicle')
const Driver = require('../models/Driver')
const Customer = require('../models/Customer')
const Transporter = require('../models/Transporter')
const Notification = require('../models/Notification')
const SystemConfig = require('../models/SystemConfig')
const {
  checkVehicleHasAssignedTrip,
  checkVehicleHasActiveTrip,
  checkDriverHasAssignedTrip,
  buildResourceTripQuery,
  getDriverAvailabilityState,
  normalizeIndianVehicleRegistration,
  isValidIndianVehicleRegistration
} = require('../utils/vehicleValidation')
const {
  markTripResourcesBusy,
  releaseTripResources,
  syncTripResourceBusyState
} = require('../utils/tripResourceState')
const {
  TRIP_STATUS,
  BOOKING_STATUS,
  TRIP_STATUS_VALUES,
  TRIP_TYPE_VALUES
} = require('../utils/tripState')

const BUSY_TRIP_STATUSES = [
  TRIP_STATUS.ACCEPTED,
  TRIP_STATUS.PLANNED,
  TRIP_STATUS.ACTIVE,
  TRIP_STATUS.PAUSED
]
const {
  emitTripCreated,
  emitTripCreatedForCustomer,
  emitBookingAccepted,
  emitBookingRejected,
  emitTripVehicleAssigned,
  emitTripDriverAssigned,
  emitTripAssigned,
  emitTripCancelled,
  emitTripUpdated
} = require('../services/socket.service')
const {
  getTransporterId,
  hasPermission
} = require('../middleware/permission.middleware')
const {
  canBookingBuyerViewTrip,
  getMarketplaceTripMetaForUser,
  getMarketplaceTripMetaForViewerId,
  transporterPartyScopeCondition
} = require('../services/tripAccess.service')
const {
  fetchMarketplacePaymentSnapshotByTrip
} = require('../services/marketplacePayment.service')
const {
  sendTripCreatedConfirmation,
  sendBookingAcceptedTemplate,
  sendDriverVehicleAssignedTemplate,
  sendBookingRejectedTemplate,
  sendBookingRequestReceivedTemplate
} = require('../services/wati.service')
const {
  syncTripLocationsToSavedCatalog
} = require('../services/savedLocation.service')
const {
  upsertCustomerLastUsed
} = require('../services/transporterCustomer.service')
const {
  assignTripQueueMetadata,
  getTripQueueInfo
} = require('../services/tripQueue.service')
const { tryAutoStartTrip } = require('./tripStatus.controller')
const { buildVisibleTrip } = require('../services/tripVisibility.service')
const {
  validateContainerNumber,
  normalizeContainerNumber
} = require('../utils/validation')
const { buildTrackingMetrics } = require('../services/tripEta.service')

const TRANSPORTER_VISIBLE_BOOKING_QUERY = {
  bookedBy: 'CUSTOMER',
  status: TRIP_STATUS.BOOKED,
  bookingStatus: BOOKING_STATUS.OPEN,
  acceptedTransporterId: null
}

const isFiniteCoordinate = value => Number.isFinite(Number(value))

const getLocationCoordinates = location => {
  if (
    !location ||
    location.coordinates === undefined ||
    location.coordinates === null
  ) {
    return { longitude: null, latitude: null }
  }

  if (Array.isArray(location.coordinates)) {
    const [longitude, latitude] = location.coordinates
    return {
      longitude: isFiniteCoordinate(longitude) ? Number(longitude) : null,
      latitude: isFiniteCoordinate(latitude) ? Number(latitude) : null
    }
  }

  return {
    longitude: isFiniteCoordinate(location.coordinates.longitude)
      ? Number(location.coordinates.longitude)
      : null,
    latitude: isFiniteCoordinate(location.coordinates.latitude)
      ? Number(location.coordinates.latitude)
      : null
  }
}

const normalizeHiredVehicle = hiredVehicle => {
  if (!hiredVehicle) {
    return null
  }

  return {
    vehicleNumber: normalizeIndianVehicleRegistration(
      hiredVehicle.vehicleNumber || ''
    ),
    trailerType: hiredVehicle.trailerType?.trim() || null
  }
}

const normalizeAdvanceAmount = value => {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Advance amount must be a non-negative number')
  }

  return parsed
}

const validateVehicleAssignmentInput = ({ vehicleId, hiredVehicle }) => {
  if (vehicleId && hiredVehicle) {
    return 'Provide either vehicleId or hiredVehicle, not both'
  }

  if (hiredVehicle) {
    const normalized = normalizeHiredVehicle(hiredVehicle)
    if (!normalized.vehicleNumber) {
      return 'hiredVehicle.vehicleNumber is required'
    }
    if (!isValidIndianVehicleRegistration(normalized.vehicleNumber)) {
      return 'hiredVehicle.vehicleNumber must be a valid 10-character Indian registration (e.g. MH12AB3434)'
    }
  }

  return null
}

const normalizeTripType = tripType =>
  typeof tripType === 'string' ? tripType.trim().toUpperCase() : tripType

const validateTripType = tripType => {
  const normalized = normalizeTripType(tripType)
  if (!normalized || !TRIP_TYPE_VALUES.includes(normalized)) {
    return null
  }
  return normalized
}

const locationHasData = location => {
  if (!location) return false
  if (typeof location !== 'object') return true
  return !!(
    location.address ||
    location.formattedAddress ||
    location.coordinates ||
    location.placeId
  )
}

const validateOperationalLocations = (
  tripType,
  { pickupLocation, intermediateLocation, dropLocation },
  { requireAll = true } = {}
) => {
  const normalized = normalizeTripType(tripType)
  const pickup = normalizeLocation(pickupLocation)
  const intermediate = normalizeLocation(intermediateLocation)
  const drop = normalizeLocation(dropLocation)

  if (pickup) {
    const pickupError = validateLocation(pickup, 'Point A')
    if (pickupError) return pickupError
  }
  if (intermediate) {
    const intermediateError = validateLocation(intermediate, 'Point B')
    if (intermediateError) return intermediateError
  }
  if (drop) {
    const dropError = validateLocation(drop, 'Point C')
    if (dropError) return dropError
  }

  if (!requireAll) {
    return null
  }

  if (normalized === 'LOCAL') {
    if (!locationHasData(pickup)) return 'Point A is required for local trips'
    if (!locationHasData(drop)) return 'Point B is required for local trips'
    if (locationHasData(intermediate)) {
      return 'Intermediate location is not allowed for local trips'
    }
    return null
  }

  if (normalized === 'IMPORT' || normalized === 'EXPORT') {
    if (!locationHasData(pickup))
      return 'Point A is required for import/export trips'
    if (!locationHasData(intermediate))
      return 'Point B is required for import/export trips'
    if (!locationHasData(drop))
      return 'Point C is required for import/export trips'
    return null
  }

  return null
}

const normalizeAndValidateContainerNumber = containerNumber => {
  const normalized = normalizeContainerNumber(containerNumber)
  if (!normalized) {
    return { value: null, error: null }
  }

  if (!validateContainerNumber(normalized)) {
    return {
      value: normalized,
      error:
        'Container number must be 4 letters followed by 7 digits (e.g. ABCD1234567)'
    }
  }

  return { value: normalized, error: null }
}

const resolveTripVehicleDriverSelection = async ({
  transporterId,
  vehicleId,
  driverId,
  contextLabel = 'Trip'
}) => {
  const hasVehicle =
    vehicleId !== undefined && vehicleId !== null && vehicleId !== ''
  const hasDriver =
    driverId !== undefined && driverId !== null && driverId !== ''

  if (!hasVehicle && !hasDriver) {
    return {
      vehicleId: null,
      driverId: null,
      vehicle: null,
      driver: null
    }
  }

  let selectedVehicle = null
  let selectedDriver = null

  if (hasVehicle) {
    const vehicleValidation = await validateOwnedVehicleAccess(
      vehicleId,
      transporterId
    )
    if (vehicleValidation.error) {
      return {
        error: vehicleValidation.error,
        statusCode: vehicleValidation.statusCode
      }
    }

    selectedVehicle = vehicleValidation.vehicle
    const linkedDriverId =
      selectedVehicle.driverId?._id || selectedVehicle.driverId

    if (!linkedDriverId) {
      return {
        error: `${contextLabel}: selected vehicle does not have a driver assigned. Please link the vehicle to a driver first.`,
        statusCode: 400
      }
    }

    const driverValidation = await validateDriverAccess(
      linkedDriverId.toString(),
      transporterId
    )
    if (driverValidation.error) {
      return {
        error: `${contextLabel}: ${driverValidation.error}`,
        statusCode: driverValidation.statusCode
      }
    }

    selectedDriver = driverValidation.driver

    const linkedVehicles = await Vehicle.find({
      driverId: linkedDriverId,
      transporterId,
      ownerType: 'OWN'
    })
      .select('_id vehicleNumber')
      .limit(2)

    if (linkedVehicles.length > 1) {
      return {
        error: `${contextLabel}: selected driver is linked to multiple vehicles. Please fix the vehicle assignment first.`,
        statusCode: 400
      }
    }

    if (hasDriver && String(driverId) !== String(linkedDriverId)) {
      return {
        error: `${contextLabel}: selected vehicle is assigned to a different driver.`,
        statusCode: 400
      }
    }

    const activeTripError = await validateVehicleIsFreeForTrip(
      selectedVehicle._id.toString()
    )
    if (activeTripError) {
      return {
        error: activeTripError,
        statusCode: 400
      }
    }

    return {
      vehicleId: selectedVehicle._id,
      driverId: selectedDriver._id,
      vehicle: selectedVehicle,
      driver: selectedDriver
    }
  }

  const driverValidation = await validateDriverAccess(driverId, transporterId)
  if (driverValidation.error) {
    return {
      error: driverValidation.error,
      statusCode: driverValidation.statusCode
    }
  }

  selectedDriver = driverValidation.driver

  const linkedVehicles = await Vehicle.find({
    driverId: selectedDriver._id,
    transporterId,
    ownerType: 'OWN'
  })
    .select('_id vehicleNumber status')
    .limit(2)

  if (linkedVehicles.length === 0) {
    return {
      error: `${contextLabel}: selected driver does not have a vehicle assigned. Please link a vehicle to this driver first.`,
      statusCode: 400
    }
  }

  if (linkedVehicles.length > 1) {
    return {
      error: `${contextLabel}: selected driver is linked to multiple vehicles. Please fix the vehicle assignment first.`,
      statusCode: 400
    }
  }

  selectedVehicle = linkedVehicles[0]

  if (selectedVehicle.status !== 'active') {
    return {
      error: `${contextLabel}: selected vehicle is not active.`,
      statusCode: 400
    }
  }

  const activeTripError = await validateVehicleIsFreeForTrip(
    selectedVehicle._id.toString()
  )
  if (activeTripError) {
    return {
      error: activeTripError,
      statusCode: 400
    }
  }

  return {
    vehicleId: selectedVehicle._id,
    driverId: selectedDriver._id,
    vehicle: selectedVehicle,
    driver: selectedDriver
  }
}

const validateUniqueAssignments = assignmentsInput => {
  if (!Array.isArray(assignmentsInput)) {
    return null
  }

  const seenVehicles = new Map()
  const seenDrivers = new Map()

  for (let i = 0; i < assignmentsInput.length; i++) {
    const assignment = assignmentsInput[i] || {}
    const vehicleKey = assignment.vehicleId ? String(assignment.vehicleId) : ''
    const driverKey = assignment.driverId ? String(assignment.driverId) : ''

    if (vehicleKey) {
      const previousIndex = seenVehicles.get(vehicleKey)
      if (previousIndex !== undefined) {
        return `Assignment ${i + 1}: vehicleId is already used in assignment ${
          previousIndex + 1
        }. Each vehicle can only be selected once per trip.`
      }
      seenVehicles.set(vehicleKey, i)
    }

    if (driverKey) {
      const previousIndex = seenDrivers.get(driverKey)
      if (previousIndex !== undefined) {
        return `Assignment ${i + 1}: driverId is already used in assignment ${
          previousIndex + 1
        }. Each driver can only be selected once per trip.`
      }
      seenDrivers.set(driverKey, i)
    }
  }

  return null
}

const validateVehicleIsFreeForTrip = async () => null

const validateOwnedVehicleAccess = async (vehicleId, transporterId) => {
  const vehicle = await Vehicle.findById(vehicleId)
  if (!vehicle) {
    return { error: 'Vehicle not found', statusCode: 404 }
  }

  if (vehicle.transporterId.toString() !== transporterId) {
    return { error: 'You do not have access to this vehicle', statusCode: 403 }
  }

  if (vehicle.ownerType !== 'OWN') {
    return {
      error: 'Only owned fleet vehicles can be assigned from the fleet',
      statusCode: 400
    }
  }

  if (vehicle.status !== 'active') {
    return { error: 'Vehicle is not active', statusCode: 400 }
  }

  return { vehicle }
}

const validateDriverAccess = async (
  driverId,
  transporterId,
  excludeTripId = null
) => {
  const driver = await Driver.findById(driverId)
  if (!driver) {
    return { error: 'Driver not found', statusCode: 404 }
  }

  if (driver.transporterId?.toString() !== transporterId) {
    return {
      error: 'Driver does not belong to your transporter account',
      statusCode: 403
    }
  }

  if (driver.status !== 'active') {
    return {
      error:
        'Only active drivers can receive trip assignments. This driver is currently inactive or pending.',
      statusCode: 400
    }
  }

  const hasActiveConflict = await Trip.findOne(
    buildResourceTripQuery(
      'driverId',
      driverId,
      [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED],
      excludeTripId
    )
  )

  if (hasActiveConflict) {
    return {
      error:
        'Driver is currently on an active trip. Please complete or cancel the active trip first.',
      statusCode: 400
    }
  }

  return { driver }
}

const normalizeLocation = location => {
  if (!location) {
    return null
  }

  const { longitude, latitude } = getLocationCoordinates(location)

  return {
    type: 'Point',
    coordinates:
      longitude !== null && latitude !== null ? [longitude, latitude] : [],
    formattedAddress:
      location.formattedAddress?.trim() || location.address?.trim() || '',
    placeId: location.placeId?.trim() || null,
    addressLine1: location.addressLine1?.trim() || null,
    locality: location.locality?.trim() || location.city?.trim() || null,
    administrativeArea:
      location.administrativeArea?.trim() || location.state?.trim() || null,
    postalCode: location.postalCode?.trim() || location.pincode?.trim() || null,
    countryCode: location.countryCode?.trim()?.toUpperCase() || null,
    name: location.name?.trim() || null,
    provider: location.provider || null,
    resolvedAt: location.resolvedAt ? new Date(location.resolvedAt) : null
  }
}

const validateLocation = (location, label) => {
  if (!location) {
    return `${label} is required`
  }

  const { latitude, longitude } = getLocationCoordinates(location)
  if (
    latitude === undefined ||
    latitude === null ||
    longitude === undefined ||
    longitude === null
  ) {
    return `${label} must include valid coordinates as [longitude, latitude] or { latitude, longitude }`
  }

  if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
    return `${label} coordinates are out of range`
  }

  const formattedAddress =
    location.formattedAddress?.trim() || location.address?.trim()
  if (!formattedAddress) {
    return `${label} formattedAddress is required`
  }

  return null
}

const serializeLocation = location => {
  if (!location) {
    return null
  }

  return normalizeLocation(location)
}

const createNotification = async ({
  userId,
  userType,
  type,
  title,
  message,
  data = {},
  priority = 'medium'
}) => {
  await Notification.create({
    userId,
    userType,
    type,
    title,
    message,
    data,
    priority
  })
}

const notifyDriverOfTripAssignment = async (trip, notificationMessage) => {
  const driverId = trip.driverId?._id || trip.driverId
  if (!driverId) {
    return
  }

  await createNotification({
    userId: driverId,
    userType: 'DRIVER',
    type: 'TRIP_DRIVER_ASSIGNED',
    title: 'New trip assigned',
    message: notificationMessage,
    data: {
      tripId: trip._id,
      publicTripId: trip.tripId,
      vehicleId: trip.vehicleId?._id || trip.vehicleId || null,
      hiredVehicle: trip.hiredVehicle || null,
      status: trip.status
    },
    priority: 'high'
  })
}

const serializeTripForRealtime = trip =>
  trip.toObject ? trip.toObject() : trip

const triggerWatiTemplate = async (handler, contextLabel) => {
  try {
    await handler()
  } catch (error) {
    console.error(`WATI ${contextLabel} failed:`, error.message)
  }
}

const toAuditUserType = userType => {
  switch (userType) {
    case 'company-user':
      return 'COMPANY_USER'
    case 'transporter':
      return 'TRANSPORTER'
    case 'customer':
      return 'CUSTOMER'
    case 'driver':
      return 'DRIVER'
    case 'admin':
      return 'ADMIN'
    default:
      return 'SYSTEM'
  }
}

const toSavedLocationActorType = userType => {
  if (userType === 'admin') {
    return 'ADMIN'
  }

  return 'SYSTEM'
}

const setAuditActor = (trip, user) => {
  trip.audit = trip.audit || {}
  trip.audit.updatedBy = {
    userId: user?.id || null,
    userType: toAuditUserType(user?.userType)
  }
}

const serializeTrip = (trip, options = {}) => {
  const tripData = trip?.toObject ? trip.toObject() : trip
  if (!tripData) {
    return null
  }

  const currentMilestone =
    options.includeCurrentMilestone && trip.getCurrentMilestone
      ? trip.getCurrentMilestone()
      : null

  const idStr = tripData._id != null ? String(tripData._id) : undefined

  const base = {
    ...tripData,
    ...(idStr ? { id: idStr } : {}),
    pickupLocation: serializeLocation(tripData.pickupLocation),
    intermediateLocation: serializeLocation(tripData.intermediateLocation),
    dropLocation: serializeLocation(tripData.dropLocation),
    vehicle: tripData.vehicleId
      ? {
          id: tripData.vehicleId._id || tripData.vehicleId,
          vehicleNumber: tripData.vehicleId.vehicleNumber,
          trailerType: tripData.vehicleId.trailerType || null,
          source: 'OWNED_FLEET'
        }
      : tripData.hiredVehicle
      ? {
          id: null,
          vehicleNumber: tripData.hiredVehicle.vehicleNumber,
          trailerType: tripData.hiredVehicle.trailerType || null,
          source: 'HIRED_TRIP_ONLY'
        }
      : null,
    currentMilestone
  }

  if (options.viewerTransporterId) {
    const meta = getMarketplaceTripMetaForViewerId(
      trip,
      options.viewerTransporterId
    )
    if (meta) {
      return appendQueueFields(
        { ...base, ...meta },
        tripData,
        options.queueInfo
      )
    }
  }

  return appendQueueFields(base, tripData, options.queueInfo)
}

const appendQueueFields = (base, tripData, queueInfo) => {
  let result = base

  if (queueInfo) {
    result = {
      ...result,
      queuePosition: queueInfo.queuePosition,
      isQueued: queueInfo.isQueued,
      blockingTripId: queueInfo.blockingTripId
    }
  } else if (tripData?.queueSequence != null) {
    result = {
      ...result,
      queuePosition: tripData.queueSequence,
      isQueued: tripData.queueSequence > 1,
      blockingTripId: null
    }
  } else {
    result = {
      ...result,
      queuePosition: null,
      isQueued: false,
      blockingTripId: null
    }
  }

  if (
    tripData?.status === TRIP_STATUS.PLANNED &&
    queueInfo &&
    queueInfo.isQueued
  ) {
    const tripId = tripData._id?.toString?.() || String(tripData._id || '')
    const blockedByOtherTrip =
      (queueInfo.blockingTripId && queueInfo.blockingTripId !== tripId) ||
      (queueInfo.queuePosition ?? 0) > 1

    if (blockedByOtherTrip) {
      result = {
        ...result,
        capabilities: {
          ...(result.capabilities || {}),
          startTrip: false
        }
      }
    }
  }

  return result
}

const serializeTripWithQueue = async (trip, options = {}) => {
  const queueInfo =
    options.includeQueueInfo === false ? null : await getTripQueueInfo(trip)
  return serializeTrip(trip, { ...options, queueInfo })
}

const buildTripAdminDetail = trip => {
  const serialized = serializeTrip(trip, { includeCurrentMilestone: true })
  if (!serialized) {
    return null
  }

  return {
    ...serialized,
    customer: trip.customerId
      ? {
          id: trip.customerId._id || trip.customerId,
          name: trip.customerId.name || null,
          mobile: trip.customerId.mobile || null,
          email: trip.customerId.email || null,
          isRegistered: trip.customerId.isRegistered ?? null
        }
      : null,
    locations: {
      pickup: serialized.pickupLocation || null,
      drop: serialized.dropLocation || null
    }
  }
}

const serializeTrips = (trips, options = {}) =>
  trips.map(trip => serializeTrip(trip, options))

const serializeTripsWithQueue = async (trips, options = {}) =>
  Promise.all(trips.map(trip => serializeTripWithQueue(trip, options)))

const sanitizeSerializedTripForMarketplaceBuyer = serialized => {
  if (!serialized || typeof serialized !== 'object') return serialized
  const next = { ...serialized }
  delete next.audit
  delete next.shareToken
  delete next.shareTokenExpiry
  if (next.shareConfig && typeof next.shareConfig === 'object') {
    const clone = { ...next.shareConfig }
    delete clone.token
    next.shareConfig = Object.keys(clone).length ? clone : undefined
  }
  return next
}

const getTripVisibilityResponse = (trip, context = {}) => {
  if (context.includeCurrentMilestone && trip?.getCurrentMilestone) {
    const tripData = trip.toObject ? trip.toObject() : { ...trip }
    tripData.currentMilestone = trip.getCurrentMilestone()
    return buildVisibleTrip(tripData, context)
  }

  return buildVisibleTrip(trip, context)
}

const getDefaultPhotoRules = async () => {
  const config = await SystemConfig.findOne({ key: 'TRIP_RULES' }).select(
    'milestoneRules'
  )
  return config?.milestoneRules || undefined
}

const populateTripReferences = async trip => {
  await trip.populate('vehicleId', 'vehicleNumber trailerType')
  await trip.populate('driverId', 'name mobile status')
  await trip.populate('transporterId', 'name company mobile')
  await trip.populate('customerId', 'name mobile email isRegistered')
  await trip.populate('acceptedTransporterId', 'name company mobile')
  if (trip.assignments?.length) {
    await trip.populate('assignments.vehicleId', 'vehicleNumber trailerType')
    await trip.populate('assignments.driverId', 'name mobile')
  }
  return trip
}

const buildAssignmentPayload = trip => ({
  trip: serializeTripForRealtime(trip),
  assignment: {
    vehicleId: trip.vehicleId?._id || trip.vehicleId || null,
    hiredVehicle: trip.hiredVehicle || null,
    driverId: trip.driverId?._id || trip.driverId || null,
    status: trip.status,
    bookingStatus: trip.bookingStatus
  }
})

const finalizeAssignmentState = trip => {
  if (trip.bookedBy === 'CUSTOMER') {
    if (trip.vehicleId || trip.hiredVehicle) {
      trip.bookingStatus = BOOKING_STATUS.ASSIGNED
    }

    if ((trip.vehicleId || trip.hiredVehicle) && trip.driverId) {
      trip.status = TRIP_STATUS.PLANNED
      if (!trip.assignedAt) {
        trip.assignedAt = new Date()
      }
    } else {
      trip.status = TRIP_STATUS.ACCEPTED
      trip.assignedAt = null
    }

    return
  }

  trip.status = TRIP_STATUS.PLANNED
}

const ensureTripAssignableByTransporter = (trip, transporterId) => {
  if (trip.bookedBy === 'CUSTOMER') {
    if (
      !trip.acceptedTransporterId ||
      trip.acceptedTransporterId.toString() !== transporterId
    ) {
      return 'Only the accepted transporter can assign this customer trip.'
    }

    if (![TRIP_STATUS.ACCEPTED, TRIP_STATUS.PLANNED].includes(trip.status)) {
      return `Trip cannot be assigned in current status: ${trip.status}`
    }

    return null
  }

  if (trip.transporterId.toString() !== transporterId) {
    return 'Access denied. You do not have permission to assign this trip.'
  }

  if (trip.status !== TRIP_STATUS.PLANNED) {
    return `Trip can only be assigned when status is ${TRIP_STATUS.PLANNED}`
  }

  return null
}

const emitAssignmentEvents = async (trip, eventName, notificationMessage) => {
  const payload = buildAssignmentPayload(trip)

  if (eventName === 'trip:vehicle:assigned') {
    emitTripVehicleAssigned(payload.trip, payload.assignment)
  } else if (eventName === 'trip:driver:assigned') {
    emitTripDriverAssigned(payload.trip, payload.assignment)
    const driverId = trip.driverId?._id || trip.driverId
    if (driverId) {
      await notifyDriverOfTripAssignment(
        trip,
        `You have been assigned trip ${trip.tripId}.`
      )
    }
  }

  if (trip.customerId) {
    await createNotification({
      userId: trip.customerId._id || trip.customerId,
      userType: 'CUSTOMER',
      type: 'TRIP_DRIVER_ASSIGNED',
      title: 'Trip assignment updated',
      message: notificationMessage,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        vehicleId: trip.vehicleId?._id || trip.vehicleId || null,
        hiredVehicle: trip.hiredVehicle || null,
        driverId: trip.driverId?._id || trip.driverId || null,
        status: trip.status
      },
      priority: 'high'
    })
  }
}

/**
 * Create a new trip
 * POST /api/trips
 */
const createTrip = async (req, res, next) => {
  try {
    // Transporters and company users with createTrips permission can create trips
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can create trips.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to create trips.'
      })
    }
    const {
      vehicleId,
      hiredVehicle,
      driverId,
      containerNumber,
      reference,
      customerName,
      pickupLocation,
      intermediateLocation,
      dropLocation,
      tripType,
      assignments: assignmentsInput,
      advanceAmount
    } = req.body
    const normalizedTripType = validateTripType(tripType)
    const normalizedCustomerName = customerName?.trim()

    let normalizedAdvanceAmount = null
    if (advanceAmount !== undefined) {
      try {
        normalizedAdvanceAmount = normalizeAdvanceAmount(advanceAmount)
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        })
      }
    }

    // Validate required fields
    if (!normalizedTripType) {
      return res.status(400).json({
        success: false,
        message: 'Trip type is required and must be IMPORT, EXPORT, or LOCAL'
      })
    }

    if (!normalizedCustomerName) {
      return res.status(400).json({
        success: false,
        message:
          'Customer name is required. Use +Add Customer to create the trip.'
      })
    }

    const hasAssignments =
      Array.isArray(assignmentsInput) && assignmentsInput.length > 0

    let tripPayload = {
      transporterId,
      containerNumber: null,
      vehicleId: null,
      hiredVehicle: null,
      driverId: null,
      reference: reference?.trim().toUpperCase() || null,
      customerName: normalizedCustomerName.toUpperCase(),
      pickupLocation: normalizeLocation(pickupLocation),
      intermediateLocation: normalizeLocation(intermediateLocation),
      dropLocation: normalizeLocation(dropLocation),
      tripType: normalizedTripType,
      advanceAmount: normalizedAdvanceAmount,
      status: TRIP_STATUS.PLANNED,
      customerOwnership: {
        ownerType: 'TRANSPORTER_MANAGED',
        payerType: 'TRANSPORTER'
      },
      visibilityMode: 'FULL_EXECUTION',
      photoRules: await getDefaultPhotoRules(),
      audit: {
        createdBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType)
        },
        updatedBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType)
        }
      }
    }

    if (hasAssignments) {
      // Multi-container mode: validate each assignment
      const duplicateAssignmentError =
        validateUniqueAssignments(assignmentsInput)
      if (duplicateAssignmentError) {
        return res.status(400).json({
          success: false,
          message: duplicateAssignmentError
        })
      }

      const assignments = []
      for (let i = 0; i < assignmentsInput.length; i++) {
        const a = assignmentsInput[i]
        const { value: cn, error: containerError } =
          normalizeAndValidateContainerNumber(a?.containerNumber)
        const vid = a?.vehicleId
        const did = a?.driverId
        if (containerError) {
          return res.status(400).json({
            success: false,
            message: `Assignment ${i + 1}: ${containerError}`
          })
        }
        if (!vid && !did) {
          return res.status(400).json({
            success: false,
            message: `Assignment ${i + 1}: vehicleId or driverId is required`
          })
        }
        const resolution = await resolveTripVehicleDriverSelection({
          transporterId,
          vehicleId: vid,
          driverId: did,
          contextLabel: `Assignment ${i + 1}`
        })

        if (resolution.error) {
          return res.status(resolution.statusCode).json({
            success: false,
            message: resolution.error
          })
        }

        assignments.push({
          containerNumber: cn,
          vehicleId: resolution.vehicleId,
          driverId: resolution.driverId
        })
      }
      tripPayload.assignments = assignments
      const first = assignments[0]
      tripPayload.containerNumber = first.containerNumber || null
      tripPayload.vehicleId = first.vehicleId
      tripPayload.driverId = first.driverId
      tripPayload.assignedAt = new Date()
    } else {
      // Legacy mode: single container/vehicle/driver
      const vehicleAssignmentError = validateVehicleAssignmentInput({
        vehicleId,
        hiredVehicle
      })
      if (vehicleAssignmentError) {
        return res.status(400).json({
          success: false,
          message: vehicleAssignmentError
        })
      }

      let normalizedHiredVehicle = null
      if (vehicleId) {
        const vehicleValidation = await validateOwnedVehicleAccess(
          vehicleId,
          transporterId
        )
        if (vehicleValidation.error) {
          return res.status(vehicleValidation.statusCode).json({
            success: false,
            message: vehicleValidation.error
          })
        }
        const activeTripError = await validateVehicleIsFreeForTrip(vehicleId)
        if (activeTripError) {
          return res.status(400).json({
            success: false,
            message: activeTripError
          })
        }
        tripPayload.vehicleId = vehicleId
      } else if (hiredVehicle) {
        normalizedHiredVehicle = normalizeHiredVehicle(hiredVehicle)
        tripPayload.hiredVehicle = normalizedHiredVehicle
      }

      const { value: normalizedContainerNumber, error: containerError } =
        normalizeAndValidateContainerNumber(containerNumber)
      if (containerError) {
        return res.status(400).json({
          success: false,
          message: containerError
        })
      }
      tripPayload.containerNumber = normalizedContainerNumber

      if (!normalizedHiredVehicle) {
        const resolution = await resolveTripVehicleDriverSelection({
          transporterId,
          vehicleId,
          driverId,
          contextLabel: 'Trip'
        })

        if (resolution.error) {
          return res.status(resolution.statusCode).json({
            success: false,
            message: resolution.error
          })
        }

        tripPayload.vehicleId = resolution.vehicleId
        tripPayload.driverId = resolution.driverId
      } else if (driverId) {
        const driverValidation = await validateDriverAccess(
          driverId,
          transporterId
        )
        if (driverValidation.error) {
          return res.status(driverValidation.statusCode).json({
            success: false,
            message: driverValidation.error
          })
        }
        tripPayload.driverId = driverValidation.driver._id
      }

      if (tripPayload.vehicleId && tripPayload.driverId) {
        tripPayload.assignedAt = new Date()
      }
    }

    const operationalLocationError = validateOperationalLocations(
      normalizedTripType,
      {
        pickupLocation,
        intermediateLocation,
        dropLocation
      }
    )
    if (operationalLocationError) {
      return res.status(400).json({
        success: false,
        message: operationalLocationError
      })
    }

    // Create trip
    const trip = new Trip(tripPayload)
    await trip.save()
    if (trip.vehicleId || trip.hiredVehicle?.vehicleNumber) {
      await assignTripQueueMetadata(trip)
    }
    await upsertCustomerLastUsed(transporterId, normalizedCustomerName)
    await markTripResourcesBusy(trip)
    await syncTripLocationsToSavedCatalog({
      trip,
      actor: {
        userId: req.user.id,
        userType: toSavedLocationActorType(req.user.userType)
      }
    })

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType')
    await trip.populate('driverId', 'name mobile')
    await trip.populate('transporterId', 'name company')
    if (trip.assignments?.length) {
      await trip.populate('assignments.vehicleId', 'vehicleNumber trailerType')
      await trip.populate('assignments.driverId', 'name mobile')
    }

    // Emit Socket.IO event
    emitTripCreated(transporterId, trip)

    res.status(201).json({
      success: true,
      message: 'Trip created successfully',
      data: await serializeTripWithQueue(trip, {
        includeCurrentMilestone: true
      })
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Validate a single route from a multi-route (batch) Create Trip request and
 * build a ready-to-save Trip payload. Does NOT persist anything.
 *
 * Each route maps 1:1 to a Trip: its own tripType, A/B/C locations and a list of
 * assignments (vehicle + driver + optional container + optional advanceAmount).
 * The route-level `advanceAmount` is the sum of its assignment advances.
 *
 * `usedVehicleIds` / `usedDriverIds` are shared Sets across all routes in the
 * batch so the same vehicle/driver can't be double-booked within one submission.
 *
 * @returns {{ payload: object }|{ error: string, statusCode: number }}
 */
const resolveRouteTripPayload = async ({
  transporterId,
  user,
  customerName,
  reference,
  route,
  tripGroupId,
  photoRules,
  usedVehicleIds,
  usedDriverIds
}) => {
  const normalizedTripType = validateTripType(route?.tripType)
  if (!normalizedTripType) {
    return {
      error: 'Trip type is required and must be IMPORT, EXPORT, or LOCAL',
      statusCode: 400
    }
  }

  const operationalLocationError = validateOperationalLocations(
    normalizedTripType,
    {
      pickupLocation: route?.pickupLocation,
      intermediateLocation: route?.intermediateLocation,
      dropLocation: route?.dropLocation
    }
  )
  if (operationalLocationError) {
    return { error: operationalLocationError, statusCode: 400 }
  }

  const assignmentsInput = Array.isArray(route?.assignments)
    ? route.assignments
    : []
  if (assignmentsInput.length === 0) {
    return {
      error: 'At least one vehicle/driver assignment is required',
      statusCode: 400
    }
  }

  const duplicateAssignmentError = validateUniqueAssignments(assignmentsInput)
  if (duplicateAssignmentError) {
    return { error: duplicateAssignmentError, statusCode: 400 }
  }

  const assignments = []
  let advanceSum = 0
  let hasAdvance = false

  for (let i = 0; i < assignmentsInput.length; i++) {
    const a = assignmentsInput[i]
    const { value: cn, error: containerError } =
      normalizeAndValidateContainerNumber(a?.containerNumber)
    if (containerError) {
      return { error: `Assignment ${i + 1}: ${containerError}`, statusCode: 400 }
    }

    if (!a?.vehicleId && !a?.driverId) {
      return {
        error: `Assignment ${i + 1}: vehicleId or driverId is required`,
        statusCode: 400
      }
    }

    let assignmentAdvance = null
    try {
      assignmentAdvance = normalizeAdvanceAmount(a?.advanceAmount)
    } catch (error) {
      return { error: `Assignment ${i + 1}: ${error.message}`, statusCode: 400 }
    }

    const resolution = await resolveTripVehicleDriverSelection({
      transporterId,
      vehicleId: a?.vehicleId,
      driverId: a?.driverId,
      contextLabel: `Assignment ${i + 1}`
    })
    if (resolution.error) {
      return { error: resolution.error, statusCode: resolution.statusCode }
    }

    const vehicleKey = resolution.vehicleId
      ? String(resolution.vehicleId)
      : ''
    const driverKey = resolution.driverId ? String(resolution.driverId) : ''

    if (vehicleKey && usedVehicleIds.has(vehicleKey)) {
      return {
        error: `Assignment ${
          i + 1
        }: this vehicle is already used in another route of this trip.`,
        statusCode: 400
      }
    }
    if (driverKey && usedDriverIds.has(driverKey)) {
      return {
        error: `Assignment ${
          i + 1
        }: this driver is already used in another route of this trip.`,
        statusCode: 400
      }
    }
    if (vehicleKey) usedVehicleIds.add(vehicleKey)
    if (driverKey) usedDriverIds.add(driverKey)

    if (assignmentAdvance != null) {
      advanceSum += assignmentAdvance
      hasAdvance = true
    }

    assignments.push({
      containerNumber: cn,
      vehicleId: resolution.vehicleId,
      driverId: resolution.driverId,
      advanceAmount: assignmentAdvance
    })
  }

  const first = assignments[0]
  const payload = {
    transporterId,
    tripGroupId,
    containerNumber: first.containerNumber || null,
    vehicleId: first.vehicleId,
    hiredVehicle: null,
    driverId: first.driverId,
    assignments,
    assignedAt: new Date(),
    reference: reference || null,
    customerName,
    pickupLocation: normalizeLocation(route?.pickupLocation),
    intermediateLocation: normalizeLocation(route?.intermediateLocation),
    dropLocation: normalizeLocation(route?.dropLocation),
    tripType: normalizedTripType,
    advanceAmount: hasAdvance ? advanceSum : null,
    status: TRIP_STATUS.PLANNED,
    customerOwnership: {
      ownerType: 'TRANSPORTER_MANAGED',
      payerType: 'TRANSPORTER'
    },
    visibilityMode: 'FULL_EXECUTION',
    photoRules,
    audit: {
      createdBy: {
        userId: user.id,
        userType: toAuditUserType(user.userType)
      },
      updatedBy: {
        userId: user.id,
        userType: toAuditUserType(user.userType)
      }
    }
  }

  return { payload }
}

/**
 * Persist a validated route payload as a Trip and run the standard create side
 * effects (queue metadata, resource busy flags, saved-location sync, socket).
 */
const persistRouteTrip = async (payload, { transporterId, user }) => {
  const trip = new Trip(payload)
  await trip.save()

  if (trip.vehicleId || trip.hiredVehicle?.vehicleNumber) {
    await assignTripQueueMetadata(trip)
  }
  await markTripResourcesBusy(trip)
  await syncTripLocationsToSavedCatalog({
    trip,
    actor: {
      userId: user.id,
      userType: toSavedLocationActorType(user.userType)
    }
  })

  await trip.populate('vehicleId', 'vehicleNumber trailerType')
  await trip.populate('driverId', 'name mobile')
  await trip.populate('transporterId', 'name company')
  if (trip.assignments?.length) {
    await trip.populate('assignments.vehicleId', 'vehicleNumber trailerType')
    await trip.populate('assignments.driverId', 'name mobile')
  }

  emitTripCreated(transporterId, trip)
  return trip
}

/**
 * Create a "trip with multiple routes": each route becomes its own Trip document
 * linked by a shared tripGroupId. Validates every route first (all-or-nothing)
 * so a partial failure never leaves half a batch; if a save fails mid-way the
 * already-created trips in the batch are removed.
 *
 * POST /api/trips/batch
 */
const createTripBatch = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can create trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to create trips.'
      })
    }

    const { customerName, reference, routes } = req.body

    const normalizedCustomerName = customerName?.trim()
    if (!normalizedCustomerName) {
      return res.status(400).json({
        success: false,
        message:
          'Customer name is required. Use +Add Customer to create the trip.'
      })
    }

    if (!Array.isArray(routes) || routes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one route is required'
      })
    }

    const upperCustomerName = normalizedCustomerName.toUpperCase()
    const normalizedReference = reference?.trim().toUpperCase() || null
    const tripGroupId = `GRP-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()}`
    const photoRules = await getDefaultPhotoRules()

    // Phase 1: validate + resolve every route (nothing persisted yet)
    const usedVehicleIds = new Set()
    const usedDriverIds = new Set()
    const preparedPayloads = []

    for (let i = 0; i < routes.length; i++) {
      const result = await resolveRouteTripPayload({
        transporterId,
        user: req.user,
        customerName: upperCustomerName,
        reference: normalizedReference,
        route: routes[i],
        tripGroupId,
        photoRules,
        usedVehicleIds,
        usedDriverIds
      })

      if (result.error) {
        return res.status(result.statusCode || 400).json({
          success: false,
          message: `Route ${i + 1}: ${result.error}`
        })
      }
      preparedPayloads.push(result.payload)
    }

    // Phase 2: persist all trips; roll back created docs on any failure
    const createdTrips = []
    try {
      for (const payload of preparedPayloads) {
        const trip = await persistRouteTrip(payload, {
          transporterId,
          user: req.user
        })
        createdTrips.push(trip)
      }
    } catch (error) {
      if (createdTrips.length > 0) {
        await Trip.deleteMany({
          _id: { $in: createdTrips.map(t => t._id) }
        }).catch(() => {})
      }
      throw error
    }

    await upsertCustomerLastUsed(transporterId, normalizedCustomerName)

    const serializedTrips = await serializeTrips(createdTrips, {
      includeCurrentMilestone: true
    })

    return res.status(201).json({
      success: true,
      message: `Trip started with ${createdTrips.length} route(s)`,
      data: {
        tripGroupId,
        trips: serializedTrips
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get all trips for authenticated transporter
 * GET /api/trips
 */
const getTrips = async (req, res, next) => {
  try {
    // Admins can see all trips, transporters and company users can see their own
    const transporterId = getTransporterId(req.user)
    const isAdmin = req.user.userType === 'admin'

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters, authorized company users, or admins can view trips.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.'
      })
    }
    const {
      status,
      vehicleId,
      driverId,
      tripType,
      transporterId: queryTransporterId,
      customerId: queryCustomerId,
      page = 1,
      limit = 20,
      startDate,
      endDate
    } = req.query

    // Build query - admins can see all; transporters see trips they execute OR marketplace trips they booked
    const query = {}
    if (!isAdmin) {
      query.$and = [transporterPartyScopeCondition(transporterId)]
    } else {
      if (queryTransporterId) query.transporterId = queryTransporterId
      if (queryCustomerId) query.customerId = queryCustomerId
    }

    if (status) {
      query.status = status
    } else {
      query.status = { $ne: TRIP_STATUS.DRAFT }
    }
    if (vehicleId) {
      query.vehicleId = vehicleId
    }
    if (driverId) {
      query.driverId = driverId
    }
    if (tripType) {
      query.tripType = tripType
    }
    if (startDate || endDate) {
      query.createdAt = {}
      if (startDate) {
        query.createdAt.$gte = new Date(startDate)
      }
      if (endDate) {
        query.createdAt.$lte = new Date(endDate)
      }
    }

    // Pagination
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    // Get trips with pagination
    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Trip.countDocuments(query)

    res.json({
      success: true,
      data: await serializeTripsWithQueue(
        trips,
        isAdmin ? {} : { viewerTransporterId: transporterId }
      ),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get trip by ID
 * GET /api/trips/:id
 */
const getTripById = async (req, res, next) => {
  try {
    const { id } = req.params
    const transporterId = getTransporterId(req.user)

    // Find trip
    const trip = await Trip.findById(id)
      .populate('vehicleId', 'vehicleNumber trailerType status')
      .populate('driverId', 'name mobile status')
      .populate('transporterId', 'name company')
      .populate('acceptedTransporterId', 'name company mobile')
      .populate('assignments.vehicleId', 'vehicleNumber trailerType')
      .populate('assignments.driverId', 'name mobile')

    if (trip && trip.isFromBooking && trip.customerId) {
      await trip.populate({
        path: 'customerId',
        model: 'Transporter',
        select: 'name company mobile'
      })
    } else if (trip && trip.customerId) {
      await trip.populate({
        path: 'customerId',
        select: 'name mobile email isRegistered'
      })
    }

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    // Check access - admins can see all trips
    const isAdmin = req.user.userType === 'admin'
    const isBookingBuyer = await canBookingBuyerViewTrip(trip, req.user)

    if (!isAdmin) {
      if (
        transporterId &&
        trip.transporterId?._id?.toString() === transporterId
      ) {
        // Check permission for company users
        if (
          req.user.userType === 'company-user' &&
          !hasPermission(req.user, 'viewTrips')
        ) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have permission to view trips.'
          })
        }
      } else if (isBookingBuyer) {
        if (
          req.user.userType === 'company-user' &&
          !hasPermission(req.user, 'viewTrips')
        ) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have permission to view trips.'
          })
        }
      } else if (req.user?.userType === 'customer') {
        if (
          !trip.customerId ||
          trip.customerId._id.toString() !== req.user.id
        ) {
          return res.status(403).json({
            success: false,
            message:
              'Access denied. You do not have permission to view this trip.'
          })
        }
      } else if (req.user?.userType === 'driver') {
        if (!trip.driverId || trip.driverId._id.toString() !== req.user.id) {
          return res.status(403).json({
            success: false,
            message:
              'Access denied. You do not have permission to view this trip.'
          })
        }
      } else if (req.user && req.user.userType !== 'driver') {
        // Drivers can view their own trips, but others need transporter access
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You do not have permission to view this trip.'
        })
      }
    }

    const data = await (async () => {
      if (isBookingBuyer) {
        const raw = serializeTrip(trip, { includeCurrentMilestone: true })
        const meta = await getMarketplaceTripMetaForUser(trip, req.user)
        const sanitized = sanitizeSerializedTripForMarketplaceBuyer(raw)
        return meta ? { ...sanitized, ...meta } : sanitized
      }
      if (isAdmin) {
        const raw = buildTripAdminDetail(trip)
        const meta = await getMarketplaceTripMetaForUser(trip, req.user)
        return meta ? { ...raw, ...meta } : raw
      }
      if (req.user?.userType === 'customer') {
        return getTripVisibilityResponse(trip, {
          actor: req.user,
          accessType: 'direct',
          includeCurrentMilestone: true
        })
      }
      const raw = await serializeTripWithQueue(trip, {
        includeCurrentMilestone: true,
        viewerTransporterId: transporterId
      })
      const meta = await getMarketplaceTripMetaForUser(trip, req.user)
      return meta ? { ...raw, ...meta } : raw
    })()

    const marketplacePayment = await fetchMarketplacePaymentSnapshotByTrip(trip)
    if (marketplacePayment?.marketplaceTrip) {
      data.marketplacePayment = marketplacePayment
    }

    res.json({
      success: true,
      data
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Update trip
 * PUT /api/trips/:id
 */
const updateTrip = async (req, res, next) => {
  try {
    const { id } = req.params
    const {
      vehicleId,
      hiredVehicle,
      driverId,
      containerNumber,
      reference,
      pickupLocation,
      intermediateLocation,
      dropLocation,
      advanceAmount
    } = req.body

    // Find trip
    const trip = await Trip.findById(id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    // Driver path: allow update of containerNumber only for assigned trips
    if (req.user.userType === 'driver') {
      const driverId = trip.driverId?._id || trip.driverId
      if (!driverId || driverId.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You can only update container for trips assigned to you.'
        })
      }
      // Allow containerNumber update for PLANNED or ACTIVE status
      if (![TRIP_STATUS.PLANNED, TRIP_STATUS.ACTIVE].includes(trip.status)) {
        return res.status(400).json({
          success: false,
          message:
            'Container can only be updated when trip is PLANNED or ACTIVE'
        })
      }
      // Driver can only update containerNumber
      if (containerNumber !== undefined) {
        const { value: normalizedContainerNumber, error: containerError } =
          normalizeAndValidateContainerNumber(containerNumber)
        if (containerError) {
          return res.status(400).json({
            success: false,
            message: containerError
          })
        }
        trip.containerNumber = normalizedContainerNumber
      }
      setAuditActor(trip, req.user)
      await trip.save()
      if (
        pickupLocation !== undefined ||
        intermediateLocation !== undefined ||
        dropLocation !== undefined
      ) {
        await syncTripLocationsToSavedCatalog({
          trip,
          actor: {
            userId: req.user.id,
            userType: toSavedLocationActorType(req.user.userType)
          }
        })
      }
      await trip.populate('vehicleId', 'vehicleNumber trailerType')
      await trip.populate('driverId', 'name mobile')
      await trip.populate('transporterId', 'name company')
      if (trip.assignments?.length) {
        await trip.populate(
          'assignments.vehicleId',
          'vehicleNumber trailerType'
        )
        await trip.populate('assignments.driverId', 'name mobile')
      }
      const driverChanged = []
      if (containerNumber !== undefined) driverChanged.push('containerNumber')
      emitTripUpdated(trip, {
        reason: 'trip_updated',
        changedFields: driverChanged
      })

      return res.json({
        success: true,
        message: 'Trip updated successfully',
        data: serializeTrip(trip, { includeCurrentMilestone: true })
      })
    }

    // Transporter path: require transporterId and createTrips permission
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can update trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update trips.'
      })
    }

    // Check access
    if (trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You do not have permission to update this trip.'
      })
    }

    const previousTripState = trip.toObject({ depopulate: true })

    // Only allow full updates (vehicle, driver, etc) if trip is PLANNED or ACCEPTED (customer-booked)
    // For containerNumber only, allow PLANNED, ACTIVE, or ACCEPTED
    const isContainerOnlyUpdate =
      containerNumber !== undefined &&
      vehicleId === undefined &&
      hiredVehicle === undefined &&
      driverId === undefined &&
      reference === undefined &&
      pickupLocation === undefined &&
      intermediateLocation === undefined &&
      dropLocation === undefined &&
      advanceAmount === undefined
    const isLocationOrContainerOnlyUpdate =
      (pickupLocation !== undefined ||
        intermediateLocation !== undefined ||
        dropLocation !== undefined) &&
      vehicleId === undefined &&
      hiredVehicle === undefined &&
      driverId === undefined &&
      containerNumber === undefined &&
      reference === undefined &&
      advanceAmount === undefined
    const isAdvanceOnlyUpdate =
      advanceAmount !== undefined &&
      vehicleId === undefined &&
      hiredVehicle === undefined &&
      driverId === undefined &&
      containerNumber === undefined &&
      reference === undefined &&
      pickupLocation === undefined &&
      intermediateLocation === undefined &&
      dropLocation === undefined

    const canUpdateVehicleDriver =
      trip.status === TRIP_STATUS.PLANNED ||
      (trip.status === TRIP_STATUS.ACCEPTED && trip.bookedBy === 'CUSTOMER')
    const canUpdateLocationAfterStart =
      [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED].includes(trip.status) &&
      isLocationOrContainerOnlyUpdate

    if (
      !isContainerOnlyUpdate &&
      !isLocationOrContainerOnlyUpdate &&
      !isAdvanceOnlyUpdate &&
      !canUpdateVehicleDriver &&
      !canUpdateLocationAfterStart
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Trip can only be updated when status is PLANNED, ACCEPTED (customer-booked), or ACTIVE for location updates'
      })
    }

    const canUpdateContainer = [
      TRIP_STATUS.PLANNED,
      TRIP_STATUS.ACTIVE,
      TRIP_STATUS.ACCEPTED
    ].includes(trip.status)
    if (isContainerOnlyUpdate && !canUpdateContainer) {
      return res.status(400).json({
        success: false,
        message:
          'Container can only be updated when trip is PLANNED, ACTIVE, or ACCEPTED'
      })
    }

    const canUpdateLocations = [
      TRIP_STATUS.PLANNED,
      TRIP_STATUS.ACTIVE,
      TRIP_STATUS.PAUSED,
      TRIP_STATUS.ACCEPTED
    ].includes(trip.status)
    if (
      (pickupLocation !== undefined ||
        intermediateLocation !== undefined ||
        dropLocation !== undefined) &&
      !canUpdateLocations
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Trip locations can only be updated when trip is PLANNED, ACTIVE, or ACCEPTED'
      })
    }

    const vehicleAssignmentProvided =
      vehicleId !== undefined || hiredVehicle !== undefined
    if (vehicleAssignmentProvided) {
      const vehicleAssignmentError = validateVehicleAssignmentInput({
        vehicleId: vehicleId === null ? null : vehicleId,
        hiredVehicle
      })

      if (vehicleAssignmentError) {
        return res.status(400).json({
          success: false,
          message: vehicleAssignmentError
        })
      }
    }

    // Validate vehicle if provided
    if (vehicleId !== undefined) {
      if (vehicleId === null) {
        trip.vehicleId = null
      } else {
        const vehicleValidation = await validateOwnedVehicleAccess(
          vehicleId,
          transporterId
        )
        if (vehicleValidation.error) {
          return res.status(vehicleValidation.statusCode).json({
            success: false,
            message: vehicleValidation.error
          })
        }

        const activeTripError = await validateVehicleIsFreeForTrip(
          vehicleId,
          trip._id.toString()
        )
        if (activeTripError) {
          return res.status(400).json({
            success: false,
            message: activeTripError
          })
        }

        trip.vehicleId = vehicleId
      }
      trip.hiredVehicle = null
    } else if (hiredVehicle !== undefined) {
      trip.vehicleId = null
      trip.hiredVehicle = hiredVehicle
        ? normalizeHiredVehicle(hiredVehicle)
        : null
    }

    // Validate driver if provided
    if (driverId !== undefined) {
      if (driverId === null) {
        trip.driverId = null
      } else {
        const driverValidation = await validateDriverAccess(
          driverId,
          transporterId,
          trip._id.toString()
        )
        if (driverValidation.error) {
          return res.status(driverValidation.statusCode).json({
            success: false,
            message: driverValidation.error
          })
        }

        trip.driverId = driverId
      }
    }

    // Update other fields
    if (containerNumber !== undefined) {
      const { value: normalized, error: containerError } =
        normalizeAndValidateContainerNumber(containerNumber)
      if (containerError) {
        return res.status(400).json({
          success: false,
          message: containerError
        })
      }
      trip.containerNumber = normalized
      if (trip.assignments?.length > 0) {
        trip.assignments[0].containerNumber = normalized
      }
    }
    if (reference !== undefined) {
      trip.reference = reference?.trim().toUpperCase() || null
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'advanceAmount')) {
      try {
        trip.advanceAmount = normalizeAdvanceAmount(advanceAmount)
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: error.message
        })
      }
    }
    if (pickupLocation !== undefined) {
      trip.pickupLocation = normalizeLocation(pickupLocation)
    }
    if (intermediateLocation !== undefined) {
      trip.intermediateLocation = normalizeLocation(intermediateLocation)
    }
    if (dropLocation !== undefined) {
      trip.dropLocation = normalizeLocation(dropLocation)
    }

    if (
      pickupLocation !== undefined ||
      intermediateLocation !== undefined ||
      dropLocation !== undefined
    ) {
      const operationalLocationError = validateOperationalLocations(
        trip.tripType,
        {
          pickupLocation: trip.pickupLocation,
          intermediateLocation: trip.intermediateLocation,
          dropLocation: trip.dropLocation
        }
      )
      if (operationalLocationError) {
        return res.status(400).json({
          success: false,
          message: operationalLocationError
        })
      }
    }

    if (
      [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED].includes(trip.status) &&
      (pickupLocation !== undefined ||
        intermediateLocation !== undefined ||
        dropLocation !== undefined)
    ) {
      trip.statusHistory = trip.statusHistory || []
      trip.statusHistory.push({
        status: trip.status,
        changedAt: new Date(),
        changedBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType)
        },
        note: `locations_updated:${[
          pickupLocation !== undefined ? 'pickupLocation' : null,
          intermediateLocation !== undefined ? 'intermediateLocation' : null,
          dropLocation !== undefined ? 'dropLocation' : null
        ]
          .filter(Boolean)
          .join(',')}`
      })
    }

    setAuditActor(trip, req.user)
    await trip.save()
    if (
      trip.status === TRIP_STATUS.PLANNED &&
      (vehicleId !== undefined ||
        hiredVehicle !== undefined ||
        driverId !== undefined)
    ) {
      await assignTripQueueMetadata(trip)
    }
    await syncTripResourceBusyState(previousTripState, trip, {
      includeAssignments: false
    })
    if (
      pickupLocation !== undefined ||
      intermediateLocation !== undefined ||
      dropLocation !== undefined
    ) {
      await syncTripLocationsToSavedCatalog({
        trip,
        actor: {
          userId: req.user.id,
          userType: toSavedLocationActorType(req.user.userType)
        }
      })
    }

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType')
    await trip.populate('driverId', 'name mobile')
    await trip.populate('transporterId', 'name company')
    if (trip.assignments?.length) {
      await trip.populate('assignments.vehicleId', 'vehicleNumber trailerType')
      await trip.populate('assignments.driverId', 'name mobile')
    }

    const updatableKeys = [
      'vehicleId',
      'hiredVehicle',
      'driverId',
      'containerNumber',
      'reference',
      'advanceAmount',
      'pickupLocation',
      'intermediateLocation',
      'dropLocation'
    ]
    const changedFields = updatableKeys.filter(k => req.body[k] !== undefined)
    emitTripUpdated(trip, { reason: 'trip_updated', changedFields })

    res.json({
      success: true,
      message: 'Trip updated successfully',
      data: await serializeTripWithQueue(trip, {
        includeCurrentMilestone: true
      })
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Cancel trip
 * PUT /api/trips/:id/cancel
 */
const cancelTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    const isAdmin = req.user.userType === 'admin'
    const isCustomer = req.user.userType === 'customer'
    const isDriver = req.user.userType === 'driver'

    if (!transporterId && !isAdmin && !isCustomer && !isDriver) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters, company users, customers, drivers, or admins can cancel trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to cancel trips.'
      })
    }

    const { id } = req.params
    const { reason } = req.body

    const trip = await Trip.findById(id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    if (isCustomer) {
      if (!trip.customerId || trip.customerId.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only cancel your own trips.'
        })
      }
    } else if (isDriver) {
      if (!trip.driverId || trip.driverId.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only cancel trips assigned to you.'
        })
      }
    } else if (!isAdmin && trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You do not have permission to cancel this trip.'
      })
    }

    const canCancelStatus =
      [TRIP_STATUS.PLANNED, TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED].includes(
        trip.status
      ) ||
      (trip.status === TRIP_STATUS.ACCEPTED && trip.bookedBy === 'CUSTOMER') ||
      trip.status === TRIP_STATUS.BOOKED
    if (!canCancelStatus) {
      return res.status(400).json({
        success: false,
        message:
          'Trip can only be cancelled when status is BOOKED, PLANNED, ACCEPTED, ACTIVE, or PAUSED'
      })
    }

    if (isCustomer) {
      if (
        ![
          TRIP_STATUS.BOOKED,
          TRIP_STATUS.ACCEPTED,
          TRIP_STATUS.PLANNED
        ].includes(trip.status)
      ) {
        return res.status(400).json({
          success: false,
          message: 'Customers can only cancel trips that are not yet active'
        })
      }
    } else if (isDriver) {
      if (trip.status !== TRIP_STATUS.PLANNED) {
        return res.status(400).json({
          success: false,
          message:
            'Drivers can only decline queued trips that are not yet started'
        })
      }
    }

    if (isDriver && trip.status === TRIP_STATUS.PLANNED) {
      trip.driverId = undefined
      trip.driverAcceptedAt = undefined
      trip.queuedAt = null
      if (Array.isArray(trip.assignments) && trip.assignments.length > 0) {
        trip.assignments = trip.assignments.filter(
          assignment => assignment?.driverId?.toString() !== req.user.id
        )
      }
      setAuditActor(trip, req.user)
      await trip.save()
      await syncTripResourceBusyState(previousTripState, trip, {
        includeAssignments: false
      })
      emitTripDriverAssigned(trip, { unassigned: true })
      return res.json({
        success: true,
        message: 'Trip declined. You have been unassigned from this trip.',
        data: serializeTrip(trip, { includeCurrentMilestone: true })
      })
    }

    trip.status = TRIP_STATUS.CANCELLED
    trip.closedReason = reason?.trim() || 'CANCELLED_BY_USER'
    trip.closedAt = new Date()
    setAuditActor(trip, req.user)
    await trip.save()
    await releaseTripResources(trip)

    emitTripCancelled(trip)

    res.json({
      success: true,
      message: 'Trip cancelled successfully',
      data: serializeTrip(trip, { includeCurrentMilestone: true })
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Search trips
 * GET /api/trips/search
 */
const searchTrips = async (req, res, next) => {
  try {
    // Admins can search all trips, transporters and company users can search their own
    const transporterId = getTransporterId(req.user)
    const isAdmin = req.user.userType === 'admin'

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters, authorized company users, or admins can search trips.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to search trips.'
      })
    }
    const { q, containerNumber, reference, page = 1, limit = 20 } = req.query

    // Support both 'q' (for containerNumber or reference) and individual params
    const searchQuery = q || containerNumber || reference
    if (!searchQuery) {
      return res.status(400).json({
        success: false,
        message: 'Please provide q (containerNumber or reference) to search'
      })
    }

    const searchTerm = (q || containerNumber || reference).trim()
    const searchClause = {
      $or: [
        {
          containerNumber: { $regex: searchTerm.toUpperCase(), $options: 'i' }
        },
        { reference: { $regex: searchTerm, $options: 'i' } }
      ]
    }

    // Build query - admins can search all trips
    const query = {}
    if (!isAdmin) {
      query.$and = [transporterPartyScopeCondition(transporterId), searchClause]
    } else {
      query.$or = searchClause.$or
    }

    // Pagination
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Trip.countDocuments(query)

    res.json({
      success: true,
      data: await serializeTripsWithQueue(
        trips,
        isAdmin ? {} : { viewerTransporterId: transporterId }
      ),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get active trips for transporter
 * GET /api/trips/active
 */
const getActiveTrips = async (req, res, next) => {
  try {
    // Admins can see all active trips, transporters and company users can see their own
    const transporterId = getTransporterId(req.user)
    const isAdmin = req.user.userType === 'admin'

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters, authorized company users, or admins can view trips.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.'
      })
    }

    const { transporterId: queryTransporterId } = req.query

    // Build query - admins can see all or filter by transporterId
    const query = { status: { $in: [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED] } }
    if (!isAdmin) {
      query.$and = [transporterPartyScopeCondition(transporterId)]
    } else if (queryTransporterId) {
      query.transporterId = queryTransporterId
    }

    const activeTrips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })

    return res.status(200).json({
      success: true,
      message: 'Active trips retrieved successfully',
      data: {
        trips: serializeTrips(
          activeTrips,
          isAdmin ? {} : { viewerTransporterId: transporterId }
        ),
        count: activeTrips.length
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get trips pending POD approval
 * GET /api/trips/pending-pod
 */
const getPendingPODTrips = async (req, res, next) => {
  try {
    // Admins can see all pending POD trips, transporters and company users can see their own
    const transporterId = getTransporterId(req.user)
    const isAdmin = req.user.userType === 'admin'

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters, authorized company users, or admins can view trips.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.'
      })
    }
    const { page = 1, limit = 20 } = req.query

    // Build query - trips with POD uploaded but not approved
    const query = {
      status: TRIP_STATUS.POD_PENDING,
      'POD.photo': { $exists: true, $ne: null },
      'POD.approvedAt': null
    }

    if (!isAdmin) {
      query.$and = [transporterPartyScopeCondition(transporterId)]
    }

    // Pagination
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('POD.uploadedBy', 'name mobile')
      .sort({ 'POD.uploadedAt': -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Trip.countDocuments(query)

    return res.status(200).json({
      success: true,
      message: 'Pending POD trips retrieved successfully',
      data: {
        trips: serializeTrips(
          trips,
          isAdmin ? {} : { viewerTransporterId: transporterId }
        ),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum)
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get trips by status
 * GET /api/trips/status/:status
 */
const getTripsByStatus = async (req, res, next) => {
  try {
    // Admins can see all trips by status, transporters and company users can see their own
    const transporterId = getTransporterId(req.user)
    const isAdmin = req.user.userType === 'admin'

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters, authorized company users, or admins can view trips.'
      })
    }

    // Check permission for company users
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.'
      })
    }
    const { status } = req.params
    const {
      page = 1,
      limit = 20,
      transporterId: queryTransporterId
    } = req.query

    // Validate status
    const validStatuses = TRIP_STATUS_VALUES
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      })
    }

    // Build query - admins can see all or filter by transporterId
    const query = { status }
    if (!isAdmin) {
      query.$and = [transporterPartyScopeCondition(transporterId)]
    } else if (queryTransporterId) {
      query.transporterId = queryTransporterId
    }

    // Pagination
    const pageNum = parseInt(page)
    const limitNum = parseInt(limit)
    const skip = (pageNum - 1) * limitNum

    const trips = await Trip.find(query)
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Trip.countDocuments(query)

    res.json({
      success: true,
      data: await serializeTripsWithQueue(
        trips,
        isAdmin ? {} : { viewerTransporterId: transporterId }
      ),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Share trip - Generate shareable link
 * POST /api/trips/:id/share
 */
const shareTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    const isCustomer = req.user.userType === 'customer'

    if (!transporterId && !isCustomer) {
      if (
        req.user.userType === 'company-user' &&
        !hasPermission(req.user, 'viewTrips')
      ) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to share trips.'
        })
      }
      if (req.user.userType !== 'company-user') {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. Only transporters, company users, or customers can share trips.'
        })
      }
    }

    const { id } = req.params
    const { expiryHours = 168, expiryDays, linkType, visibilityMode } = req.body // Default 7 days (168 hours)

    const trip = await Trip.findById(id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    if (isCustomer) {
      if (!trip.customerId || trip.customerId.toString() !== req.user.id) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only share your own trips.'
        })
      }
    } else {
      if (trip.transporterId.toString() !== transporterId) {
        return res.status(403).json({
          success: false,
          message:
            'Access denied. You do not have permission to share this trip.'
        })
      }
    }

    // Generate share token
    const shareToken = require('crypto').randomBytes(32).toString('hex')
    const shareTokenExpiry = new Date()

    // Support both expiryHours and expiryDays for backward compatibility
    if (expiryDays !== undefined) {
      shareTokenExpiry.setDate(
        shareTokenExpiry.getDate() + parseInt(expiryDays)
      )
    } else {
      shareTokenExpiry.setHours(
        shareTokenExpiry.getHours() + parseInt(expiryHours)
      )
    }

    // Update trip with share token
    trip.shareToken = shareToken
    trip.shareTokenExpiry = shareTokenExpiry
    trip.shareConfig = {
      enabled: true,
      linkType:
        linkType === 'ORIGIN_PICKUP' ? 'ORIGIN_PICKUP' : 'TRIP_VISIBILITY',
      visibilityMode:
        visibilityMode === 'FULL_EXECUTION' ? 'FULL_EXECUTION' : 'STATUS_ONLY',
      token: shareToken,
      expiresAt: shareTokenExpiry,
      sharedAt: new Date(),
      sharedBy: {
        userId: req.user.id,
        userType: toAuditUserType(req.user.userType)
      }
    }
    setAuditActor(trip, req.user)
    await trip.save()

    // Generate full shareable URL
    const protocol = req.protocol
    const host = req.get('host')
    const baseUrl = `${protocol}://${host}`
    const shareLink = `${baseUrl}/api/trips/shared/${shareToken}/view`

    res.json({
      success: true,
      message: 'Trip share link generated successfully',
      data: {
        shareToken,
        shareLink,
        shareUrl: shareLink, // Alias for consistency
        expiryDate: shareTokenExpiry
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get shared trip by token
 * GET /api/trips/shared/:token
 */
const getSharedTrip = async (req, res, next) => {
  try {
    const { token } = req.params

    // Find trip by share token
    const trip = await Trip.findOne({
      shareToken: token,
      shareTokenExpiry: { $gt: new Date() } // Token not expired
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company')

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Shared trip not found or link has expired'
      })
    }

    res.json({
      success: true,
      data: {
        ...getTripVisibilityResponse(trip, { accessType: 'shared' }),
        ...(trip.status === TRIP_STATUS.ACTIVE && trip.lastDriverLocation
          ? { lastDriverLocation: trip.lastDriverLocation }
          : {})
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Render shared trip HTML view
 * GET /api/trips/shared/:token/view
 */
const renderSharedTrip = async (req, res, next) => {
  try {
    const { token } = req.params

    // Find trip by share token
    const trip = await Trip.findOne({
      shareToken: token,
      shareTokenExpiry: { $gt: new Date() } // Token not expired
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company')

    if (!trip) {
      return res.render('shared-trip', {
        error: {
          title: 'Link Expired or Invalid',
          message:
            'This trip sharing link has expired or is invalid. Please request a new link.'
        }
      })
    }

    // Format status label
    const statusLabels = {
      [TRIP_STATUS.BOOKED]: 'Booked',
      [TRIP_STATUS.ACCEPTED]: 'Accepted',
      [TRIP_STATUS.PLANNED]: 'Planned',
      [TRIP_STATUS.ACTIVE]: 'Active',
      [TRIP_STATUS.PAUSED]: 'Paused',
      [TRIP_STATUS.POD_PENDING]: 'POD Pending',
      [TRIP_STATUS.CLOSED_WITH_POD]: 'Closed With POD',
      [TRIP_STATUS.CLOSED_WITHOUT_POD]: 'Closed Without POD',
      [TRIP_STATUS.CANCELLED]: 'Cancelled'
    }

    // Format date
    const formatDate = date => {
      if (!date) return ''
      const d = new Date(date)
      return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    }

    const visibleTrip = getTripVisibilityResponse(trip, {
      accessType: 'shared'
    })
    const pickCoords = trip.pickupLocation?.coordinates
    const dropCoords = trip.dropLocation?.coordinates
    const isActive = trip.status === TRIP_STATUS.ACTIVE
    const trackingEnabled =
      isActive &&
      pickCoords &&
      dropCoords &&
      typeof pickCoords.latitude === 'number' &&
      typeof pickCoords.longitude === 'number' &&
      typeof dropCoords.latitude === 'number' &&
      typeof dropCoords.longitude === 'number'

    const tripData = {
      ...visibleTrip,
      status: visibleTrip.status.toLowerCase(),
      statusLabel: statusLabels[trip.status] || trip.status,
      createdAt: formatDate(visibleTrip.createdAt),
      scheduledAt: formatDate(visibleTrip.scheduledAt),
      startedAt: formatDate(visibleTrip.startedAt),
      completedAt: formatDate(visibleTrip.completedAt),
      podDueAt: formatDate(visibleTrip.podDueAt),
      vehicleId: visibleTrip.vehicle || null,
      driverId: visibleTrip.driverId || null,
      transporterId: visibleTrip.transporterId || null
    }

    const googleMapsApiKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_DIRECTIONS_KEY ||
      'AIzaSyA6EcL6hrD0iQpwk6ETUQNSieeEBYUR1_U'

    res.render('shared-trip', {
      trip: tripData,
      tracking: trackingEnabled
        ? {
            shareToken: token,
            pickup: { lat: pickCoords.latitude, lng: pickCoords.longitude },
            drop: { lat: dropCoords.latitude, lng: dropCoords.longitude },
            lastDriverLocation: trip.lastDriverLocation || null,
            googleMapsApiKey
          }
        : null
    })
  } catch (error) {
    console.error('Error rendering shared trip:', error)
    res.render('shared-trip', {
      error: {
        title: 'Error Loading Trip',
        message:
          'An error occurred while loading the trip details. Please try again later.'
      }
    })
  }
}

/**
 * Customer books a trip
 * POST /api/trips/customer/book
 */
const bookCustomerTrip = async (req, res, next) => {
  try {
    if (req.user.userType !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only customers can book trips.'
      })
    }

    const {
      tripType,
      containerNumber,
      reference,
      pickupLocation,
      dropLocation,
      scheduledAt,
      loadType,
      notes
    } = req.body
    const normalizedTripType = validateTripType(tripType)

    if (!normalizedTripType) {
      return res.status(400).json({
        success: false,
        message: 'Trip type is required and must be IMPORT, EXPORT, or LOCAL'
      })
    }

    const pickupError = validateLocation(pickupLocation, 'Pickup location')
    if (pickupError) {
      return res.status(400).json({ success: false, message: pickupError })
    }

    const dropError = validateLocation(dropLocation, 'Drop location')
    if (dropError) {
      return res.status(400).json({ success: false, message: dropError })
    }

    const customer = await Customer.findById(req.user.id)
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      })
    }

    const { error: containerError } =
      normalizeAndValidateContainerNumber(containerNumber)
    if (containerError) {
      return res.status(400).json({
        success: false,
        message: containerError
      })
    }

    const photoRules = await getDefaultPhotoRules()

    const trip = await Trip.create({
      customerId: customer._id,
      bookedBy: 'CUSTOMER',
      bookingStatus: BOOKING_STATUS.OPEN,
      status: TRIP_STATUS.BOOKED,
      tripType: normalizedTripType,
      containerNumber: (() => {
        const { value, error } =
          normalizeAndValidateContainerNumber(containerNumber)
        if (error) {
          return null
        }
        return value
      })(),
      reference: reference?.trim() || null,
      pickupLocation: normalizeLocation(pickupLocation),
      dropLocation: normalizeLocation(dropLocation),
      customerName: customer.name || req.body.customerName?.trim() || null,
      customerMobile: customer.mobile,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      loadType: loadType?.trim() || null,
      notes: notes?.trim() || null,
      customerOwnership: {
        ownerType: 'CUSTOMER_MANAGED',
        payerType: 'CUSTOMER'
      },
      visibilityMode: 'FULL_EXECUTION',
      photoRules,
      audit: {
        createdBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType)
        },
        updatedBy: {
          userId: req.user.id,
          userType: toAuditUserType(req.user.userType)
        }
      }
    })

    await syncTripLocationsToSavedCatalog({
      trip,
      actor: {
        userId: req.user.id,
        userType: toSavedLocationActorType(req.user.userType)
      }
    })

    const activeTransporters = await Transporter.find({
      status: 'active',
      hasAccess: true
    }).select('_id name company mobile')
    const customerTripData = serializeTripForRealtime(trip)

    await Promise.all(
      activeTransporters.map(transporter =>
        createNotification({
          userId: transporter._id,
          userType: 'TRANSPORTER',
          type: 'TRIP_BOOKED',
          title: 'New customer trip booked',
          message: `A new customer trip ${trip.tripId} is available for acceptance.`,
          data: {
            tripId: trip._id,
            publicTripId: trip.tripId,
            customerName: trip.customerName,
            pickupLocation: trip.pickupLocation,
            dropLocation: trip.dropLocation
          },
          priority: 'high'
        })
      )
    )

    await Promise.all(
      activeTransporters.map(transporter =>
        triggerWatiTemplate(
          () =>
            sendBookingRequestReceivedTemplate({
              transporter,
              trip
            }),
          `booking request received template for transporter ${transporter._id}`
        )
      )
    )

    // Emit trip:created to each transporter with hasAccess for real-time app notification
    activeTransporters.forEach(t => {
      emitTripCreated(t._id.toString(), customerTripData)
    })

    // Emit trip:created to customer so their list updates without refresh
    emitTripCreatedForCustomer(customer._id.toString(), customerTripData)

    await trip.populate('customerId', 'name mobile email isRegistered')
    await triggerWatiTemplate(
      () =>
        sendTripCreatedConfirmation({
          customer,
          trip
        }),
      'trip created confirmation'
    )

    return res.status(201).json({
      success: true,
      message: 'Trip booked successfully',
      data: serializeTrip(trip)
    })
  } catch (error) {
    console.error('bookCustomerTrip failed:', error)
    if (typeof next === 'function') {
      return next(error)
    }

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error'
    })
  }
}

/**
 * Customer gets own trips
 * GET /api/trips/customer/my-trips
 */
const getCustomerTrips = async (req, res, next) => {
  try {
    if (req.user.userType !== 'customer') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only customers can view their trips.'
      })
    }

    const { page = 1, limit = 20, status } = req.query
    const query = { customerId: req.user.id }

    if (status) {
      query.status = status
    }

    const pageNum = parseInt(page, 10)
    const limitNum = parseInt(limit, 10)
    const skip = (pageNum - 1) * limitNum

    const trips = await Trip.find(query)
      .populate('acceptedTransporterId', 'name company mobile')
      .populate('transporterId', 'name company mobile')
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Trip.countDocuments(query)

    return res.status(200).json({
      success: true,
      data: trips.map(trip =>
        getTripVisibilityResponse(trip, {
          actor: req.user,
          accessType: 'direct'
        })
      ),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Transporter gets customer trip history
 * GET /api/trips/customer/history
 */
const getCustomerTripsByCustomer = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)

    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can view customer trips.'
      })
    }

    // Company user permission check
    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.'
      })
    }

    const { customerId, customerName, page = 1, limit = 20, status } = req.query

    if (!customerId && !customerName) {
      return res.status(400).json({
        success: false,
        message: 'customerId or customerName is required.'
      })
    }

    /**
     * Mongo Query
     */
    const query = {
      transporterId
    }

    if (customerId) {
      query.customerId = customerId
    }

    if (customerName) {
      query.customerName = {
        $regex: customerName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i'
      }
    }

    if (status) {
      query.status = status
    }

    const pageNum = Number(page)
    const limitNum = Number(limit)
    const skip = (pageNum - 1) * limitNum

    /**
     * Optimized Query
     */
    const trips = await Trip.find(query)
      .select(
        `
        tripId
        customerId
        customerName
        customerMobile
        reference
        tripType
        pickupLocation.formattedAddress
        dropLocation.formattedAddress
        intermediateLocation.formattedAddress
        vehicleId
        driverId
        containerNumber
        assignments
        advanceAmount
        status
        createdAt
      `
      )
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({
        createdAt: -1
      })
      .skip(skip)
      .limit(limitNum)
      .lean()

    const total = await Trip.countDocuments(query)

    /**
     * Total Advance Amount
     */
    const totalAdvanceAmount = trips.reduce(
      (sum, trip) => sum + (trip.advanceAmount || 0),
      0
    )

    /**
     * Lightweight Response
     */
    const response = trips.map(trip => ({
      id: trip._id,

      tripId: trip.tripId,

      customer: {
        id: trip.customerId,
        name: trip.customerName,
        mobile: trip.customerMobile
      },

      route: {
        pickup: trip.pickupLocation?.formattedAddress || null,

        intermediate: trip.intermediateLocation?.formattedAddress || null,

        drop: trip.dropLocation?.formattedAddress || null
      },

      tripType: trip.tripType,

      vehicle: trip.vehicleId
        ? {
            id: trip.vehicleId._id,
            vehicleNumber: trip.vehicleId.vehicleNumber,
            trailerType: trip.vehicleId.trailerType
          }
        : null,

      driver: trip.driverId
        ? {
            id: trip.driverId._id,
            name: trip.driverId.name,
            mobile: trip.driverId.mobile
          }
        : null,

      containers: {
        count: trip.assignments?.length || 0,

        numbers: trip.assignments?.map(item => item.containerNumber) || []
      },

      reference: trip.reference,

      advanceAmount: trip.advanceAmount || 0,

      status: trip.status,

      createdAt: trip.createdAt
    }))

    return res.status(200).json({
      success: true,

      data: response,

      totalAdvanceAmount,

      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Transporter gets customer active trips
 * GET /api/trips/customer/active
 */
const getActiveCustomerTrips = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)

    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can view customer trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.'
      })
    }

    const { customerId, customerName, page = 1, limit = 20 } = req.query

    if (!customerId && !customerName) {
      return res.status(400).json({
        success: false,
        message: 'customerId or customerName is required.'
      })
    }

    // Active trip query
    const query = {
      transporterId,

      status: {
        $in: [
          TRIP_STATUS.BOOKED,
          TRIP_STATUS.ACCEPTED,
          TRIP_STATUS.PLANNED,
          TRIP_STATUS.ACTIVE,
          TRIP_STATUS.PAUSED
        ]
      }
    }

    if (customerId) {
      query.customerId = customerId
    }

    if (customerName) {
      query.customerName = {
        $regex: customerName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i'
      }
    }

    const pageNum = Number(page)
    const limitNum = Number(limit)
    const skip = (pageNum - 1) * limitNum

    const trips = await Trip.find(query)
      .select(
        `
        tripId
        customerId
        customerName
        customerMobile
        reference
        tripType
        pickupLocation.formattedAddress
        pickupLocation.coordinates
        dropLocation.formattedAddress
        dropLocation.coordinates
        intermediateLocation.formattedAddress
        intermediateLocation.coordinates
        vehicleId
        driverId
        assignments
        status
        createdAt
        lastDriverLocation
        driverTracking.status
        driverTracking.lastHeartbeatAt
        driverTracking.lastLocationAt
        milestones
      `
      )
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .sort({
        createdAt: -1
      })
      .skip(skip)
      .limit(limitNum)
      .lean()

    const total = await Trip.countDocuments(query)

    const response = trips.map(trip => {
      const hasDriverLocation =
        trip.lastDriverLocation?.latitude != null &&
        trip.lastDriverLocation?.longitude != null

      const tripProgress = hasDriverLocation
        ? buildTrackingMetrics(
            trip,
            trip.lastDriverLocation.latitude,
            trip.lastDriverLocation.longitude
          )
        : {
            etaSeconds: null,
            distanceRemainingMeters: null,
            routeProgressPercent: null,
            movementStage: null
          }

      return {
        id: trip._id,

        tripId: trip.tripId,

        customer: {
          id: trip.customerId,
          name: trip.customerName,
          mobile: trip.customerMobile
        },

        route: {
          pickup: {
            address: trip.pickupLocation?.formattedAddress || null,
            coordinates: trip.pickupLocation?.coordinates || null
          },

          intermediate: {
            address: trip.intermediateLocation?.formattedAddress || null,
            coordinates: trip.intermediateLocation?.coordinates || null
          },

          drop: {
            address: trip.dropLocation?.formattedAddress || null,
            coordinates: trip.dropLocation?.coordinates || null
          }
        },

        vehicle: trip.vehicleId,

        driver: trip.driverId,

        containers: {
          count: trip.assignments?.length || 0,
          numbers: trip.assignments?.map(a => a.containerNumber) || []
        },

        tripType: trip.tripType,

        reference: trip.reference,

        status: trip.status,

        createdAt: trip.createdAt,

        lastDriverLocation: trip.lastDriverLocation || null,

        tripProgress,

        tracking: {
          driverTrackingStatus: trip.driverTracking?.status || null,
          lastHeartbeatAt: trip.driverTracking?.lastHeartbeatAt || null,
          lastLocationAt: trip.driverTracking?.lastLocationAt || null
        }
      }
    })

    return res.status(200).json({
      success: true,
      data: response,

      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    next(error)
  }
}

const getAvailableCustomerTrips = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can view available customer trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'viewTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view trips.'
      })
    }

    const { page = 1, limit = 20, tripType } = req.query
    const query = { ...TRANSPORTER_VISIBLE_BOOKING_QUERY }
    query.rejectedTransporterIds = { $ne: transporterId }
    if (tripType) {
      query.tripType = tripType
    }

    const pageNum = parseInt(page, 10)
    const limitNum = parseInt(limit, 10)
    const skip = (pageNum - 1) * limitNum

    const trips = await Trip.find(query)
      .populate('customerId', 'name mobile email isRegistered')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)

    const total = await Trip.countDocuments(query)

    return res.status(200).json({
      success: true,
      data: serializeTrips(trips),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Transporter accepts a customer trip
 * PUT /api/trips/:id/accept
 */
const acceptCustomerTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can accept customer trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to accept trips.'
      })
    }

    const trip = await Trip.findOneAndUpdate(
      {
        _id: req.params.id,
        ...TRANSPORTER_VISIBLE_BOOKING_QUERY,
        rejectedTransporterIds: { $ne: transporterId }
      },
      {
        $set: {
          acceptedTransporterId: transporterId,
          transporterId,
          acceptedAt: new Date(),
          bookingStatus: BOOKING_STATUS.ACCEPTED,
          status: TRIP_STATUS.ACCEPTED,
          'audit.updatedBy.userId': req.user.id,
          'audit.updatedBy.userType': toAuditUserType(req.user.userType),
          'audit.acceptedBy.userId': req.user.id,
          'audit.acceptedBy.userType': toAuditUserType(req.user.userType)
        }
      },
      { new: true }
    )
      .populate('customerId', 'name mobile email isRegistered')
      .populate('acceptedTransporterId', 'name company mobile')

    if (!trip) {
      return res.status(409).json({
        success: false,
        message: 'Trip has already been accepted or is no longer available.'
      })
    }

    await createNotification({
      userId: trip.customerId._id,
      userType: 'CUSTOMER',
      type: 'TRIP_ACCEPTED',
      title: 'Trip accepted by transporter',
      message: `Your trip ${trip.tripId} has been accepted by a transporter.`,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        transporterId
      },
      priority: 'high'
    })

    emitBookingAccepted(trip)

    await triggerWatiTemplate(
      () =>
        sendBookingAcceptedTemplate({
          customer: trip.customerId,
          trip
        }),
      'booking accepted template'
    )

    const autoStartedTrip = await tryAutoStartTrip(
      trip,
      req.user.id,
      req.user.userType
    )

    return res.status(200).json({
      success: true,
      message: autoStartedTrip
        ? 'Customer trip accepted and started successfully'
        : 'Customer trip accepted successfully',
      data: await serializeTripWithQueue(autoStartedTrip || trip)
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Transporter rejects a customer trip
 * PUT /api/trips/:id/reject
 */
const rejectCustomerTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can reject customer trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to reject trips.'
      })
    }

    const trip = await Trip.findOne({
      _id: req.params.id,
      ...TRANSPORTER_VISIBLE_BOOKING_QUERY,
      rejectedTransporterIds: { $ne: transporterId }
    }).populate('customerId', 'name mobile email isRegistered')

    if (!trip) {
      return res.status(409).json({
        success: false,
        message:
          'Trip is no longer available for rejection or was already rejected by you.'
      })
    }

    trip.rejectedTransporterIds.push(transporterId)
    setAuditActor(trip, req.user)
    await trip.save()

    await createNotification({
      userId: trip.customerId._id,
      userType: 'CUSTOMER',
      type: 'TRIP_REJECTED',
      title: 'Booking rejected by transporter',
      message: `Your trip ${trip.tripId} was not accepted by a transporter.`,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        transporterId
      },
      priority: 'high'
    })

    emitBookingRejected({ trip, transporterId })

    await triggerWatiTemplate(
      () =>
        sendBookingRejectedTemplate({
          customer: trip.customerId,
          trip
        }),
      'booking rejected template'
    )

    return res.status(200).json({
      success: true,
      message: 'Customer trip rejected successfully',
      data: serializeTrip(trip)
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Assign or change a vehicle for a trip.
 * PUT /api/trips/:id/assign-vehicle
 */
const assignTripVehicle = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can assign vehicles.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to assign vehicles.'
      })
    }

    const { vehicleId, hiredVehicle } = req.body
    if (!vehicleId && !hiredVehicle) {
      return res.status(400).json({
        success: false,
        message: 'Either vehicleId or hiredVehicle is required'
      })
    }

    const vehicleAssignmentError = validateVehicleAssignmentInput({
      vehicleId,
      hiredVehicle
    })
    if (vehicleAssignmentError) {
      return res.status(400).json({
        success: false,
        message: vehicleAssignmentError
      })
    }

    const trip = await Trip.findById(req.params.id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    const previousTripState = trip.toObject({ depopulate: true })

    const assignmentError = ensureTripAssignableByTransporter(
      trip,
      transporterId
    )
    if (assignmentError) {
      return res.status(400).json({
        success: false,
        message: assignmentError
      })
    }

    if (vehicleId) {
      const vehicleValidation = await validateOwnedVehicleAccess(
        vehicleId,
        transporterId
      )
      if (vehicleValidation.error) {
        return res.status(vehicleValidation.statusCode).json({
          success: false,
          message: vehicleValidation.error
        })
      }
      const activeTripError = await validateVehicleIsFreeForTrip(
        vehicleId,
        req.params.id
      )
      if (activeTripError) {
        return res.status(400).json({
          success: false,
          message: activeTripError
        })
      }
      trip.vehicleId = vehicleId
      trip.hiredVehicle = null
    } else {
      trip.vehicleId = null
      trip.hiredVehicle = normalizeHiredVehicle(hiredVehicle)
    }

    finalizeAssignmentState(trip)
    setAuditActor(trip, req.user)
    await trip.save()
    if (trip.status === TRIP_STATUS.PLANNED) {
      await assignTripQueueMetadata(trip)
    }
    await syncTripResourceBusyState(previousTripState, trip, {
      includeAssignments: false
    })
    await populateTripReferences(trip)

    await emitAssignmentEvents(
      trip,
      'trip:vehicle:assigned',
      `Vehicle has been assigned to your trip ${trip.tripId}.`
    )

    return res.status(200).json({
      success: true,
      message: 'Vehicle assigned successfully',
      data: await serializeTripWithQueue(trip, {
        includeCurrentMilestone: true
      })
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Assign or change a driver for a trip.
 * PUT /api/trips/:id/assign-driver
 */
const assignTripDriver = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can assign drivers.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to assign drivers.'
      })
    }

    const { driverId } = req.body
    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'driverId is required'
      })
    }

    const trip = await Trip.findById(req.params.id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    const previousTripState = trip.toObject({ depopulate: true })

    const assignmentError = ensureTripAssignableByTransporter(
      trip,
      transporterId
    )
    if (assignmentError) {
      return res.status(400).json({
        success: false,
        message: assignmentError
      })
    }

    const driverValidation = await validateDriverAccess(
      driverId,
      transporterId,
      req.params.id
    )
    if (driverValidation.error) {
      return res.status(driverValidation.statusCode).json({
        success: false,
        message: driverValidation.error
      })
    }

    trip.driverId = driverId
    finalizeAssignmentState(trip)
    setAuditActor(trip, req.user)
    await trip.save()
    if (trip.vehicleId || trip.hiredVehicle?.vehicleNumber) {
      await assignTripQueueMetadata(trip)
    }
    await syncTripResourceBusyState(previousTripState, trip, {
      includeAssignments: false
    })
    await populateTripReferences(trip)

    await emitAssignmentEvents(
      trip,
      'trip:driver:assigned',
      `Driver has been assigned to your trip ${trip.tripId}.`
    )

    const autoStartedTrip = await tryAutoStartTrip(
      trip,
      req.user.id,
      req.user.userType
    )
    const responseTrip = autoStartedTrip || trip

    return res.status(200).json({
      success: true,
      message: autoStartedTrip
        ? 'Driver assigned and trip started successfully'
        : 'Driver assigned successfully',
      data: await serializeTripWithQueue(responseTrip, {
        includeCurrentMilestone: true
      })
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Transporter assigns vehicle and driver to accepted trip
 * PUT /api/trips/:id/assign
 */
const assignCustomerTrip = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can assign trips.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to assign trips.'
      })
    }

    const { vehicleId, hiredVehicle, driverId } = req.body
    if ((!vehicleId && !hiredVehicle) || !driverId) {
      return res.status(400).json({
        success: false,
        message: 'driverId and either vehicleId or hiredVehicle are required'
      })
    }

    const vehicleAssignmentError = validateVehicleAssignmentInput({
      vehicleId,
      hiredVehicle
    })
    if (vehicleAssignmentError) {
      return res.status(400).json({
        success: false,
        message: vehicleAssignmentError
      })
    }

    const trip = await Trip.findById(req.params.id)
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    const previousTripState = trip.toObject({ depopulate: true })

    if (trip.bookedBy !== 'CUSTOMER') {
      return res.status(400).json({
        success: false,
        message: 'This trip was not booked by a customer.'
      })
    }

    if (
      !trip.acceptedTransporterId ||
      trip.acceptedTransporterId.toString() !== transporterId
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only the accepted transporter can assign vehicle and driver.'
      })
    }

    if (![TRIP_STATUS.ACCEPTED, TRIP_STATUS.PLANNED].includes(trip.status)) {
      return res.status(400).json({
        success: false,
        message: `Trip cannot be assigned in current status: ${trip.status}`
      })
    }

    let normalizedHiredVehicle = null
    if (vehicleId) {
      const vehicleValidation = await validateOwnedVehicleAccess(
        vehicleId,
        transporterId
      )
      if (vehicleValidation.error) {
        return res.status(vehicleValidation.statusCode).json({
          success: false,
          message: vehicleValidation.error
        })
      }
      const activeTripError = await validateVehicleIsFreeForTrip(
        vehicleId,
        trip._id.toString()
      )
      if (activeTripError) {
        return res.status(400).json({
          success: false,
          message: activeTripError
        })
      }
    } else {
      normalizedHiredVehicle = normalizeHiredVehicle(hiredVehicle)
    }

    const driverValidation = await validateDriverAccess(
      driverId,
      transporterId,
      trip._id.toString()
    )
    if (driverValidation.error) {
      return res.status(driverValidation.statusCode).json({
        success: false,
        message: driverValidation.error
      })
    }

    trip.vehicleId = vehicleId || null
    trip.hiredVehicle = normalizedHiredVehicle
    trip.driverId = driverId
    trip.transporterId = transporterId
    finalizeAssignmentState(trip)
    setAuditActor(trip, req.user)
    await trip.save()
    if (trip.status === TRIP_STATUS.PLANNED) {
      await assignTripQueueMetadata(trip)
    }
    await syncTripResourceBusyState(previousTripState, trip, {
      includeAssignments: false
    })

    await populateTripReferences(trip)

    await createNotification({
      userId: trip.customerId._id,
      userType: 'CUSTOMER',
      type: 'TRIP_DRIVER_ASSIGNED',
      title: 'Vehicle and driver assigned',
      message: `Vehicle and driver have been assigned to your trip ${trip.tripId}.`,
      data: {
        tripId: trip._id,
        publicTripId: trip.tripId,
        vehicleId: trip.vehicleId?._id,
        hiredVehicle: trip.hiredVehicle || null,
        driverId: trip.driverId?._id
      },
      priority: 'high'
    })

    await notifyDriverOfTripAssignment(
      trip,
      `You have been assigned trip ${trip.tripId}.`
    )

    emitTripAssigned(trip, buildAssignmentPayload(trip).assignment)

    await triggerWatiTemplate(
      () =>
        sendDriverVehicleAssignedTemplate({
          customer: trip.customerId,
          trip
        }),
      'driver and vehicle assigned template'
    )

    return res.status(200).json({
      success: true,
      message: 'Vehicle and driver assigned successfully',
      data: await serializeTripWithQueue(trip, {
        includeCurrentMilestone: true
      })
    })
  } catch (error) {
    next(error)
  }
}

const buildDraftPayload = (body, transporterId, user) => {
  const normalizedTripType = body.tripType
    ? validateTripType(body.tripType)
    : null
  const normalizedCustomerName = body.customerName?.trim()

  return {
    transporterId,
    containerNumber: (() => {
      const { value, error } = normalizeAndValidateContainerNumber(
        body.containerNumber
      )
      return error ? null : value
    })(),
    vehicleId: body.vehicleId || null,
    hiredVehicle: body.hiredVehicle
      ? normalizeHiredVehicle(body.hiredVehicle)
      : null,
    driverId: body.driverId || null,
    reference: body.reference?.trim()?.toUpperCase() || null,
    customerName: normalizedCustomerName
      ? normalizedCustomerName.toUpperCase()
      : null,
    pickupLocation: normalizeLocation(body.pickupLocation),
    intermediateLocation: normalizeLocation(body.intermediateLocation),
    dropLocation: normalizeLocation(body.dropLocation),
    tripType: normalizedTripType || TRIP_TYPE_VALUES[0],
    assignments: Array.isArray(body.assignments) ? body.assignments : [],
    // Raw multi-route builder payload for the batch (multi-route) Create Trip
    // flow. When present, the app rehydrates its route list from this instead of
    // the single-route fields above.
    batchDraft:
      body.batchDraft && typeof body.batchDraft === 'object'
        ? body.batchDraft
        : null,
    status: TRIP_STATUS.DRAFT,
    customerOwnership: {
      ownerType: 'TRANSPORTER_MANAGED',
      payerType: 'TRANSPORTER'
    },
    visibilityMode: 'FULL_EXECUTION',
    audit: {
      createdBy: { userId: user.id, userType: toAuditUserType(user.userType) },
      updatedBy: { userId: user.id, userType: toAuditUserType(user.userType) }
    }
  }
}

const saveTripDraft = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can save drafts.'
      })
    }

    if (
      req.user.userType === 'company-user' &&
      !hasPermission(req.user, 'createTrips')
    ) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. You do not have permission to save trip drafts.'
      })
    }

    const { draftId } = req.body
    const payload = buildDraftPayload(req.body, transporterId, req.user)

    let trip
    if (draftId) {
      trip = await Trip.findOne({
        _id: draftId,
        transporterId,
        status: TRIP_STATUS.DRAFT
      })
      if (!trip) {
        return res.status(404).json({
          success: false,
          message: 'Draft not found'
        })
      }
      Object.assign(trip, payload)
      // Mixed-type field: Mongoose can't auto-detect nested changes on update.
      trip.markModified('batchDraft')
      setAuditActor(trip, req.user)
    } else {
      trip = new Trip(payload)
    }

    await trip.save()

    return res.status(draftId ? 200 : 201).json({
      success: true,
      message: draftId
        ? 'Draft updated successfully'
        : 'Draft saved successfully',
      data: serializeTrip(trip)
    })
  } catch (error) {
    next(error)
  }
}

const listTripDrafts = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can view drafts.'
      })
    }

    const drafts = await Trip.find({ transporterId, status: TRIP_STATUS.DRAFT })
      .sort({ updatedAt: -1 })
      .limit(50)

    return res.status(200).json({
      success: true,
      data: serializeTrips(drafts)
    })
  } catch (error) {
    next(error)
  }
}

const getTripDraftById = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can view drafts.'
      })
    }

    const trip = await Trip.findOne({
      _id: req.params.id,
      transporterId,
      status: TRIP_STATUS.DRAFT
    })

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Draft not found'
      })
    }

    return res.status(200).json({
      success: true,
      data: serializeTrip(trip)
    })
  } catch (error) {
    next(error)
  }
}

const deleteTripDraft = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message:
          'Access denied. Only transporters and authorized company users can delete drafts.'
      })
    }

    const trip = await Trip.findOneAndDelete({
      _id: req.params.id,
      transporterId,
      status: TRIP_STATUS.DRAFT
    })

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Draft not found'
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Draft deleted successfully'
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  bookCustomerTrip,
  getCustomerTrips,
  getCustomerTripsByCustomer,
  getActiveCustomerTrips,
  getAvailableCustomerTrips,
  acceptCustomerTrip,
  rejectCustomerTrip,
  assignTripVehicle,
  assignTripDriver,
  assignCustomerTrip,
  saveTripDraft,
  listTripDrafts,
  getTripDraftById,
  deleteTripDraft,
  createTrip,
  createTripBatch,
  getTrips,
  getTripById,
  updateTrip,
  cancelTrip,
  searchTrips,
  getTripsByStatus,
  getActiveTrips,
  getPendingPODTrips,
  shareTrip,
  getSharedTrip,
  renderSharedTrip
}
