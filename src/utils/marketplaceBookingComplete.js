const VehicleBooking = require('../models/VehicleBooking')
const { getIO } = require('../services/socket.service')
const { CLOSED_TRIP_STATUSES } = require('./tripState')

/**
 * Notify both transporter parties that a marketplace booking reached COMPLETED (trip closed).
 * @param {object} bookingLean - lean booking with buyerId/sellerId populated or ObjectIds
 */
function emitBookingCompleted(bookingLean) {
  try {
    const io = getIO()
    if (!io || !bookingLean) return
    const buyerId =
      bookingLean.buyerId?._id?.toString() ||
      bookingLean.buyerId?.toString?.() ||
      null
    const sellerId =
      bookingLean.sellerId?._id?.toString() ||
      bookingLean.sellerId?.toString?.() ||
      null
    const payload = { booking: bookingLean }
    if (buyerId) io.to(`transporter:${buyerId}`).emit('booking:completed', payload)
    if (sellerId) io.to(`transporter:${sellerId}`).emit('booking:completed', payload)
  } catch (e) {
    console.warn('emit booking:completed failed:', e.message || e)
  }
}

/**
 * When a marketplace trip reaches a terminal closed status, mark CONFIRMED booking as COMPLETED.
 * Idempotent if already COMPLETED.
 * @param {import('../models/Trip')} trip - saved trip with status in CLOSED_TRIP_STATUSES
 * @returns {Promise<object|null>} updated or existing booking lean, or null
 */
async function completeMarketplaceBookingAfterTripClosed(trip) {
  if (!trip?.bookingId || !trip.isFromBooking) return null
  if (!CLOSED_TRIP_STATUSES.includes(trip.status)) return null

  const existing = await VehicleBooking.findById(trip.bookingId).lean()
  if (!existing) return null
  if (existing.status === 'COMPLETED') {
    return existing
  }
  if (existing.status !== 'CONFIRMED') return null

  const booking = await VehicleBooking.findByIdAndUpdate(
    trip.bookingId,
    { $set: { status: 'COMPLETED', completedAt: new Date() } },
    { new: true }
  )
    .populate('buyerId', 'name mobile company')
    .populate('sellerId', 'name mobile company')
    .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
    .populate('postId', 'origin destination availableFrom availableTo')
    .populate('tripId', 'status closedAt closedReason')
    .lean()

  if (booking) emitBookingCompleted(booking)
  return booking
}

module.exports = {
  emitBookingCompleted,
  completeMarketplaceBookingAfterTripClosed
}
