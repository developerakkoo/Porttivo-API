const Trip = require('../models/Trip')
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability')
const VehicleRouteAssignment = require('../models/VehicleRouteAssignment')
const { TRIP_STATUS } = require('../utils/tripState')

const createTripFromBooking = async booking => {
  if (!booking) {
    throw new Error('Booking is required')
  }

  // ✅ Idempotency
  if (booking.tripId) {
    const existingTrip = await Trip.findById(booking.tripId)
    if (existingTrip) return existingTrip
  }

  // ✅ Status validation
  if (booking.status !== 'CONFIRMED') {
    throw new Error(`Trip can only be created for CONFIRMED booking`)
  }

  // ✅ Load data
  const [post, assignment] = await Promise.all([
    VehicleRouteAvailability.findById(booking.postId),
    VehicleRouteAssignment.findById(booking.assignmentId)
  ])

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
  const allowedTypes = ['IMPORT', 'EXPORT']
  const tripType = allowedTypes.includes(booking.tripType)
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

  const session = await Trip.startSession()
  session.startTransaction()

  try {
    const [trip] = await Trip.create([tripPayload], { session })

    booking.tripId = trip._id
    await booking.save({ session })

    await session.commitTransaction()
    session.endSession()

    return trip
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    throw error
  }
}

module.exports = { createTripFromBooking }