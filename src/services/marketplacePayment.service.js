const mongoose = require('mongoose')
const Trip = require('../models/Trip')
const VehicleBooking = require('../models/VehicleBooking')
const MarketplacePayment = require('../models/MarketplacePayment')
const logger = require('../utils/logger')
const { isMarketplaceBookingTrip } = require('./tripAccess.service')
const {
  buildPaymentInitiationRequest,
  makeTransactionId
} = require('../services/paymentGateway.service')
const { isPayeePayoutReady } = require('./razorpayPayout.service')
const { marketplaceRazorpayWebhookUrl } = require('../config/env')

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
  fetchImpl = global.fetch
}) => {
  if (!trip || !booking) {
    throw new Error('Trip and booking are required to build a marketplace payment request')
  }

  const finalAmount = Number(booking.agreedPrice)
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    throw new Error('Final negotiated price is missing for this booking')
  }

  const recipientTransporterId = toObjectIdString(
    booking.sellerId || trip.transporterId
  )
  const payoutReadiness = await isPayeePayoutReady(recipientTransporterId)
  if (!payoutReadiness?.ready) {
    throw new Error(
      "Payment cannot proceed because the recipient transporter's Razorpay beneficiary details have not been added or are not active"
    )
  }

  const buyer = normalizeMarketplaceBuyer(booking, payerOverrides)
  if (!buyer.email) {
    throw new Error('Buyer email is required to initiate Razorpay payment')
  }

  logger.info('[MARKETPLACE_PAYMENT] Preparing payment request', {
    tripId: trip._id?.toString(),
    bookingId: booking._id?.toString(),
    buyerId: buyer.userId,
    recipientId: recipientTransporterId,
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
    const hasCheckoutReady =
      existingPayment.paymentRequest?.actionUrl &&
      (existingRequestFields.order_id || existingRequestFields.txnid)
    if (hasCheckoutReady) {
      logger.info('[MARKETPLACE_PAYMENT] Reusing existing payment request', {
        paymentId: existingPayment._id?.toString(),
        orderId: existingRequestFields.order_id || existingRequestFields.txnid
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
        provider: 'RAZORPAY',
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

    payment.paymentRequest = await buildPaymentInitiationRequest({
      provider: 'RAZORPAY',
      merchantTransactionId,
      amount: finalAmount,
      buyer,
      reference: {
        referenceType: 'BOOKING',
        referenceId: toObjectIdString(booking._id),
        purpose: `Marketplace trip ${trip.tripId || trip._id}`
      },
      paymentSessionId: payment._id,
      callbackUrl: marketplaceRazorpayWebhookUrl,
      fetchImpl
    })
    payment.providerOrderId =
      payment.paymentRequest?.rawResponse?.id ||
      payment.paymentRequest?.fields?.order_id ||
      payment.providerOrderId ||
      null
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
      orderId: payment.paymentRequest?.fields?.order_id
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

const buildMarketplacePaymentSnapshot = ({ trip, booking, payment, payeePayoutReadiness }) => {
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
  const recipientBeneficiaryReady = payeePayoutReadiness
    ? Boolean(payeePayoutReadiness.ready)
    : false
  const recipientBeneficiaryReason = payeePayoutReadiness?.reason || (sellerId ? 'RAZORPAY_BENEFICIARY_NOT_READY' : null)

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
      recipientBeneficiaryReady,
      recipientBeneficiaryReason,
      canInitiatePayment:
        marketplaceTrip &&
        tripStarted &&
        milestoneOneCompleted &&
        booking?.status === 'CONFIRMED' &&
        Number.isFinite(agreedPrice) &&
        agreedPrice > 0 &&
        paymentStatus !== 'SUCCESS' &&
        recipientBeneficiaryReady
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
    return buildMarketplacePaymentSnapshot({ trip, booking: null, payment: null, payeePayoutReadiness: null })
  }

  const bookingId = trip.bookingId._id || trip.bookingId
  const [booking, payment] = await Promise.all([
    VehicleBooking.findById(bookingId)
      .populate('buyerId', 'name company mobile email')
      .populate('sellerId', 'name company mobile email'),
    MarketplacePayment.findOne({ tripId: trip._id }).sort({ createdAt: -1 })
  ])

  const sellerId = toObjectIdString(booking?.sellerId || trip.transporterId)
  const payeePayoutReadiness = sellerId ? await isPayeePayoutReady(sellerId) : null

  return buildMarketplacePaymentSnapshot({ trip, booking, payment, payeePayoutReadiness })
}

module.exports = {
  buildMarketplacePaymentSnapshot,
  fetchMarketplacePaymentSnapshotByTrip,
  isMilestoneOneCompleted,
  createMarketplacePaymentRequestForTrip
}
