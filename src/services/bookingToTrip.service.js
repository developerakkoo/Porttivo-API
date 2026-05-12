const Trip = require('../models/Trip')
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability')
const VehicleRouteAssignment = require('../models/VehicleRouteAssignment')
const { TRIP_STATUS, TRIP_TYPE_VALUES } = require('../utils/tripState')

const createTripFromBooking = async (booking, options = {}) => {
  if (!booking) {
    throw new Error('Booking is required')
  }

  const { session = null } = options

  // ✅ Idempotency
  if (booking.tripId) {
    const existingTripQuery = Trip.findById(booking.tripId)
    if (session) existingTripQuery.session(session)
    const existingTrip = await existingTripQuery
    if (existingTrip) return existingTrip
  }

  // ✅ Status validation
  if (booking.status !== 'CONFIRMED') {
    throw new Error(`Trip can only be created for CONFIRMED booking`)
  }

  // ✅ Load data
  const postQuery = VehicleRouteAvailability.findById(booking.postId)
  const assignmentQuery = VehicleRouteAssignment.findById(booking.assignmentId)
  if (session) {
    postQuery.session(session)
    assignmentQuery.session(session)
  }
  const [post, assignment] = await Promise.all([postQuery, assignmentQuery])

  if (!post) throw new Error('VehicleRouteAvailability not found')
  if (!assignment) throw new Error('VehicleRouteAssignment not found')

  if (assignment.postId.toString() !== booking.postId.toString()) {
    throw new Error('Assignment mismatch')
  }

  // 🔥 SMART LOCATION BUILDER (FIXED)
  const buildLocation = location => {
    // if new schema (object)
    if (location && location.coordinates) {
      return {
        type: 'Point',
        coordinates: location.coordinates,
        formattedAddress: location.formattedAddress || ''
      }
    }

    // fallback (old string data)
    return {
      type: 'Point',
      coordinates: [0, 0],
      formattedAddress: location || ''
    }
  }

  // ✅ TripType logic
  const tripType = TRIP_TYPE_VALUES.includes(booking.tripType)
    ? booking.tripType
    : 'EXPORT'

  const tripPayload = {
    transporterId: booking.sellerId, // ✅ seller executes trip
    customerId: booking.buyerId,     // ✅ buyer is customer

    vehicleId: booking.vehicleId,
    driverId: null,

    pickupLocation: buildLocation(post.origin),
    dropLocation: buildLocation(post.destination),

    tripType,
    status: TRIP_STATUS.PLANNED,

    bookingId: booking._id,
    isFromBooking: true,

    reference: `BOOK-${booking._id.toString().slice(-6)}`,

    audit: {
      createdBy: {
        userId: booking.buyerId,
        userType: 'TRANSPORTER'
      },
      updatedBy: {
        userId: booking.buyerId,
        userType: 'TRANSPORTER'
      }
    }
  }

  try {
    if (session) {
      const [trip] = await Trip.create([tripPayload], { session })
      booking.tripId = trip._id
      await booking.save({ session })
      return trip
    }

    const tripSession = await Trip.startSession()
    tripSession.startTransaction()

    try {
      const [trip] = await Trip.create([tripPayload], { session: tripSession })

      booking.tripId = trip._id
      await booking.save({ session: tripSession })

      await tripSession.commitTransaction()
      tripSession.endSession()

      return trip
    } catch (error) {
      await tripSession.abortTransaction()
      tripSession.endSession()
      throw error
    }
  } catch (error) {
    throw error
  }
}

module.exports = { createTripFromBooking }
