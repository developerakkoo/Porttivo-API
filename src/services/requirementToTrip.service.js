const Trip = require('../models/Trip')
const Transporter = require('../models/Transporter')
const { TRIP_STATUS, TRIP_TYPE_VALUES } = require('../utils/tripState')

/**
 * Create a PLANNED marketplace Trip from an awarded Quote + Requirement.
 * Mirrors bookingToTrip.service: the quoting transporter executes the trip,
 * the requester is the customer. Idempotent on quote.tripId.
 */
const createTripFromQuote = async (requirement, quote, options = {}) => {
  if (!requirement) throw new Error('Requirement is required')
  if (!quote) throw new Error('Quote is required')

  const { session = null } = options

  // Idempotency
  if (quote.tripId) {
    const existingQuery = Trip.findById(quote.tripId)
    if (session) existingQuery.session(session)
    const existing = await existingQuery
    if (existing) return existing
  }

  const buildLocation = (location) => {
    if (location && location.coordinates) {
      return {
        type: 'Point',
        coordinates: location.coordinates,
        formattedAddress: location.formattedAddress || ''
      }
    }
    return {
      type: 'Point',
      coordinates: [0, 0],
      formattedAddress: location || ''
    }
  }

  const tripType = TRIP_TYPE_VALUES.includes(requirement.direction)
    ? requirement.direction
    : 'EXPORT'

  const originLoc = buildLocation(requirement.origin)
  const destLoc = buildLocation(requirement.destination)
  // Export/Local: origin -> destination. Import: destination -> origin.
  const pickupLocation = tripType === 'IMPORT' ? destLoc : originLoc
  const dropLocation = tripType === 'IMPORT' ? originLoc : destLoc

  const requesterTransporter = await Transporter.findById(requirement.requesterId)
    .select('name company mobile')
    .lean()
    .catch(() => null)

  const buyerLabel =
    requesterTransporter?.company ||
    requesterTransporter?.name ||
    `Transporter ${String(requirement.requesterId).slice(-6)}`

  const tripPayload = {
    transporterId: quote.transporterId, // winner executes trip
    customerId: requirement.requesterId, // requester is customer
    customerName: buyerLabel,
    customerMobile: requesterTransporter?.mobile || null,
    vehicleId: null,
    driverId: null,

    pickupLocation,
    dropLocation,

    tripType,
    status: TRIP_STATUS.PLANNED,

    requirementId: requirement._id,
    quoteId: quote._id,
    isFromInquiry: true,

    reference: requirement.ref || `REQ-${String(requirement._id).slice(-6)}`,

    audit: {
      createdBy: {
        userId: requirement.requesterId,
        userType: 'TRANSPORTER'
      },
      updatedBy: {
        userId: requirement.requesterId,
        userType: 'TRANSPORTER'
      }
    }
  }

  const persist = async (sess) => {
    const [trip] = await Trip.create([tripPayload], { session: sess })
    quote.tripId = trip._id
    await quote.save({ session: sess })
    return trip
  }

  if (session) {
    return persist(session)
  }

  const tripSession = await Trip.startSession()
  tripSession.startTransaction()
  try {
    const trip = await persist(tripSession)
    await tripSession.commitTransaction()
    tripSession.endSession()
    return trip
  } catch (error) {
    await tripSession.abortTransaction()
    tripSession.endSession()
    throw error
  }
}

module.exports = { createTripFromQuote }
