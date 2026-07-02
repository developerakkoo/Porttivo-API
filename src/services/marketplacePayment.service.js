const Trip = require('../models/Trip')
const VehicleBooking = require('../models/VehicleBooking')
const MarketplacePayment = require('../models/MarketplacePayment')
const { isMarketplaceBookingTrip } = require('./tripAccess.service')

const toObjectIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString ? value.toString() : String(value)
}

const isMilestoneOneCompleted = (trip) =>
  Array.isArray(trip?.milestones)
    ? trip.milestones.some((milestone) => milestone?.milestoneNumber === 1)
    : false

const buildMarketplacePaymentSnapshot = ({ trip, booking, payment }) => {
  if (!trip) {
    return null
  }

  const bookingId = booking?._id || trip.bookingId?._id || trip.bookingId || null
  const buyerId = toObjectIdString(booking?.buyerId || trip.customerId)
  const sellerId = toObjectIdString(booking?.sellerId || trip.transporterId)
  const agreedPrice = Number(booking?.agreedPrice)
  const milestoneOneCompleted = isMilestoneOneCompleted(trip)
  const marketplaceTrip = isMarketplaceBookingTrip(trip) && Boolean(bookingId)
  const tripStarted = trip.status === 'ACTIVE'
  const paymentStatus = booking?.paymentStatus || payment?.status || 'PENDING'

  return {
    marketplaceTrip,
    tripId: trip._id ? trip._id.toString() : null,
    tripPublicId: trip.tripId || null,
    bookingId: bookingId ? bookingId.toString() : null,
    payerTransporterId: buyerId,
    beneficiaryTransporterId: sellerId,
    agreedPrice: Number.isFinite(agreedPrice) ? agreedPrice : null,
    paymentStatus,
    tripStarted,
    milestoneOneCompleted,
    payment: payment
      ? {
          id: payment._id ? payment._id.toString() : null,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          merchantTransactionId: payment.merchantTransactionId,
          providerTransactionId: payment.providerTransactionId || null,
          providerOrderId: payment.providerOrderId || null,
          completedAt: payment.completedAt || null,
          failedAt: payment.failedAt || null
        }
      : null,
    eligibility: {
      marketplaceTrip,
      tripStarted,
      milestoneOneCompleted,
      bookingConfirmed: booking?.status === 'CONFIRMED',
      hasAgreedPrice: Number.isFinite(agreedPrice) && agreedPrice > 0,
      canInitiatePayment:
        marketplaceTrip &&
        tripStarted &&
        milestoneOneCompleted &&
        booking?.status === 'CONFIRMED' &&
        Number.isFinite(agreedPrice) &&
        agreedPrice > 0 &&
        paymentStatus !== 'SUCCESS'
    }
  }
}

const fetchMarketplacePaymentSnapshotByTrip = async (tripInput) => {
  const trip =
    tripInput && typeof tripInput === 'object' && tripInput._id
      ? tripInput
      : await Trip.findById(tripInput)

  if (!trip) {
    return null
  }

  if (!isMarketplaceBookingTrip(trip) || !trip.bookingId) {
    return buildMarketplacePaymentSnapshot({ trip, booking: null, payment: null })
  }

  const bookingId = trip.bookingId._id || trip.bookingId
  const [booking, payment] = await Promise.all([
    VehicleBooking.findById(bookingId)
      .populate('buyerId', 'name company mobile email')
      .populate('sellerId', 'name company mobile email'),
    MarketplacePayment.findOne({ tripId: trip._id }).sort({ createdAt: -1 })
  ])

  return buildMarketplacePaymentSnapshot({ trip, booking, payment })
}

module.exports = {
  buildMarketplacePaymentSnapshot,
  fetchMarketplacePaymentSnapshotByTrip,
  isMilestoneOneCompleted
}
