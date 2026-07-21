const mongoose = require('mongoose')
const Trip = require('../models/Trip')
const VehicleBooking = require('../models/VehicleBooking')
const MarketplacePayment = require('../models/MarketplacePayment')
const logger = require('../utils/logger')
const { isMarketplaceBookingTrip } = require('./tripAccess.service')
const { buildMarketplaceTripPaymentRequest, makeTransactionId } = require('../services/payu.service')

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

const normalizeMarketplaceBuyer = (booking, overrides = {}) => {
  const buyer = booking.buyerId && booking.buyerId.toObject ? booking.buyerId.toObject() : booking.buyerId

  return {
    userId: buyer?._id || buyer?._id || null,
    userType: 'transporter',
    name:
      overrides.name || buyer?.name || buyer?.company || 'Marketplace Buyer',
    email: String(overrides.email || buyer?.email || '').trim().toLowerCase() || null,
    mobile: String(overrides.mobile || buyer?.mobile || '').trim() || null
  }
}

const buildPaymentPayoutMetadata = (booking) => {
  return {
    payout: {
      payeeId: toObjectIdString(booking.sellerId),
      payeeType: 'TRANSPORTER',
      transferMode: 'IMPS',
      referenceType: 'BOOKING',
      referenceId: toObjectIdString(booking._id),
      amount: Number(booking.agreedPrice),
      currency: 'INR'
    }
  }
}

const createMarketplacePaymentRequestForTrip = async ({
  trip,
  booking,
  initiatedBy = {},
  payerOverrides = {},
  successUrl,
  failureUrl
}) => {
  if (!trip || !booking) {
    throw new Error('Trip and booking are required to build a marketplace payment request')
  }

  const finalAmount = Number(booking.agreedPrice)
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    throw new Error('Final negotiated price is missing for this booking')
  }

  const buyer = normalizeMarketplaceBuyer(booking, payerOverrides)
  if (!buyer.email) {
    throw new Error('Buyer email is required to initiate PayU payment')
  }

  logger.info('[MARKETPLACE_PAYMENT] Preparing payment request', {
    tripId: trip._id?.toString(),
    bookingId: booking._id?.toString(),
    buyerId: buyer.userId,
    amount: finalAmount
  })

  const existingPayment = await MarketplacePayment.findOne({ tripId: trip._id }).sort({ createdAt: -1 })

  if (existingPayment) {
    logger.info('[MARKETPLACE_PAYMENT] Existing payment found for trip', {
      tripId: trip._id?.toString(),
      paymentId: existingPayment._id?.toString(),
      status: existingPayment.status
    })

    if (existingPayment.status === 'SUCCESS') {
      return existingPayment
    }

    const existingRequestFields = existingPayment.paymentRequest?.fields || {}
    if (existingRequestFields.txnid && existingPayment.paymentRequest?.actionUrl) {
      logger.info('[MARKETPLACE_PAYMENT] Reusing existing payment request', {
        paymentId: existingPayment._id?.toString(),
        txnid: existingRequestFields.txnid
      })
      return existingPayment
    }
  }

  const merchantTransactionId = existingPayment?.merchantTransactionId || makeTransactionId()

  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const payment =
      existingPayment ||
      new MarketplacePayment({
        publicId: `mp_${makeTransactionId().slice(4, 16)}`,
        tripId: trip._id,
        bookingId: booking._id,
        payerTransporterId: toObjectIdString(booking.buyerId),
        beneficiaryTransporterId: toObjectIdString(booking.sellerId),
        provider: 'PAYU',
        status: 'CREATED',
        amount: finalAmount,
        currency: 'INR',
        merchantTransactionId,
        paymentGatewayUrl: null,
        paymentRequest: {},
        paymentResponse: {},
        callbackPayload: {},
        metadata: buildPaymentPayoutMetadata(booking),
        referenceType: 'BOOKING',
        referenceId: toObjectIdString(booking._id),
        initiatedBy,
        initiatedAt: new Date()
      })

    payment.paymentRequest = buildMarketplaceTripPaymentRequest({
      merchantTransactionId,
      amount: finalAmount,
      buyer,
      trip,
      booking,
      paymentId: payment._id,
      successUrl,
      failureUrl
    })
    payment.paymentGatewayUrl = payment.paymentRequest.actionUrl
    payment.status = 'PENDING'
    payment.amount = finalAmount
    payment.currency = 'INR'
    payment.payerTransporterId = toObjectIdString(booking.buyerId)
    payment.beneficiaryTransporterId = toObjectIdString(booking.sellerId)
    payment.metadata = {
      ...(payment.metadata || {}),
      ...buildPaymentPayoutMetadata(booking)
    }

    await payment.save({ session })

    booking.paymentStatus = 'HOLD'
    await booking.save({ session })

    await session.commitTransaction()
    session.endSession()

    logger.info('[MARKETPLACE_PAYMENT] Marketplace payment request created', {
      paymentId: payment._id?.toString(),
      tripId: trip._id?.toString(),
      bookingId: booking._id?.toString(),
      amount: payment.amount,
      txnid: payment.paymentRequest?.fields?.txnid
    })

    return payment
  } catch (error) {
    await session.abortTransaction()
    session.endSession()
    logger.error('[MARKETPLACE_PAYMENT] Marketplace payment request creation failed', {
      tripId: trip._id?.toString(),
      bookingId: booking._id?.toString(),
      message: error.message
    })
    throw error
  }
}

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
  isMilestoneOneCompleted,
  createMarketplacePaymentRequestForTrip
}
