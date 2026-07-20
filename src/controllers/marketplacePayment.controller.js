const mongoose = require('mongoose')
const { nanoid } = require('nanoid')
const Trip = require('../models/Trip')
const VehicleBooking = require('../models/VehicleBooking')
const MarketplacePayment = require('../models/MarketplacePayment')
const { getTransporterActorId } = require('../utils/transporterActor')
const { canTransporterPartyViewTripExecution, isMarketplaceBookingTrip } = require('../services/tripAccess.service')
const { isConfigured, buildMarketplaceTripPaymentRequest, verifyPayuResponseHash, normalizePayuStatus, makeTransactionId } = require('../services/payu.service')
const { payuSuccessUrl, payuFailureUrl } = require('../config/env')

const toObjectIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString ? value.toString() : String(value)
}

const getPaymentPublicId = (payment) => {
  if (!payment) return null
  return payment.publicId || (payment._id ? payment._id.toString() : null)
}

const getMarketplaceTripPaymentContext = async (tripId) => {
  const trip = await Trip.findById(tripId)
    .populate('transporterId', 'name company mobile email')
    .populate('customerId', 'name company mobile email')
    .populate('bookingId')

  if (!trip) {
    return { trip: null, booking: null }
  }

  const bookingId = trip.bookingId?._id || trip.bookingId
  const booking = bookingId
    ? await VehicleBooking.findById(bookingId)
        .populate('buyerId', 'name company mobile email')
        .populate('sellerId', 'name company mobile email')
    : null

  return { trip, booking }
}

const getLatestPaymentForTrip = async (tripId) => {
  return MarketplacePayment.findOne({ tripId })
    .sort({ createdAt: -1 })
    .lean()
}

const assertMarketplacePayableTrip = async (tripId, user) => {
  const { trip, booking } = await getMarketplaceTripPaymentContext(tripId)

  if (!trip) {
    return { error: 'Trip not found', statusCode: 404 }
  }

  if (!isMarketplaceBookingTrip(trip) || !trip.bookingId) {
    return {
      error: 'Payments are only available for marketplace trips',
      statusCode: 400
    }
  }

  if (trip.status !== 'ACTIVE') {
    return {
      error: 'Payment can only be initiated once the trip has started',
      statusCode: 400
    }
  }

  const milestoneOneCompleted = Array.isArray(trip.milestones)
    ? trip.milestones.some((milestone) => milestone?.milestoneNumber === 1)
    : false

  if (!milestoneOneCompleted) {
    return {
      error: 'Payment can only be initiated after milestone 1 is completed',
      statusCode: 400
    }
  }

  if (!booking) {
    return {
      error: 'Booking not found for this trip',
      statusCode: 404
    }
  }

  if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
    return {
      error: 'Payment can only be initiated for confirmed marketplace bookings',
      statusCode: 400
    }
  }

  const actorId = getTransporterActorId(user)
  if (!actorId) {
    return {
      error: 'Only transporter accounts can initiate marketplace payments',
      statusCode: 403
    }
  }

  const buyerId = toObjectIdString(booking.buyerId)
  if (actorId !== buyerId) {
    return {
      error: 'Only the booking buyer can initiate payment for this trip',
      statusCode: 403
    }
  }

  const finalAmount = Number(booking.agreedPrice)
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    return {
      error: 'Final negotiated price is missing for this booking',
      statusCode: 400
    }
  }

  const existingPayment = await getLatestPaymentForTrip(trip._id)

  return {
    trip,
    booking,
    actorId,
    finalAmount,
    milestoneOneCompleted,
    existingPayment
  }
}

const initiateMarketplaceTripPayuPayment = async (req, res, next) => {
  try {
    if (!isConfigured()) {
      return res.status(500).json({
        success: false,
        message: 'PayU is not configured'
      })
    }

    const { tripId } = req.params
    const { payerName, payerEmail, payerPhone } = req.body || {}
    const context = await assertMarketplacePayableTrip(tripId, req.user)

    if (context.error) {
      return res.status(context.statusCode || 400).json({
        success: false,
        message: context.error
      })
    }

    const { trip, booking, finalAmount, existingPayment } = context

    if (existingPayment?.status === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        message: 'Payment has already been completed for this trip',
        data: {
          payment: existingPayment
        }
      })
    }

    if (
      existingPayment?.status === 'CREATED' ||
      existingPayment?.status === 'PENDING'
    ) {
      if (
        existingPayment.paymentRequest?.fields?.txnid &&
        existingPayment.paymentRequest?.actionUrl
      ) {
        return res.status(200).json({
          success: true,
          message: 'A payment request already exists for this trip',
          data: {
            payment: existingPayment
          }
        })
      }

      const buyerForRecovery = {
        ...(booking.buyerId?.toObject ? booking.buyerId.toObject() : booking.buyerId),
        name:
          payerName ||
          booking.buyerId?.name ||
          booking.buyerId?.company ||
          'Marketplace Buyer',
        email: payerEmail || booking.buyerId?.email || '',
        mobile: payerPhone || booking.buyerId?.mobile || ''
      }

      if (!buyerForRecovery.email) {
        return res.status(400).json({
          success: false,
          message: 'Buyer email is required to initiate PayU payment'
        })
      }

      const rebuiltRequest = buildMarketplaceTripPaymentRequest({
        merchantTransactionId: existingPayment.merchantTransactionId,
        amount: finalAmount,
        buyer: buyerForRecovery,
        trip,
        booking,
        paymentId: existingPayment._id,
        successUrl: payuSuccessUrl,
        failureUrl: payuFailureUrl
      })

      existingPayment.paymentGatewayUrl = rebuiltRequest.actionUrl
      existingPayment.paymentRequest = rebuiltRequest
      existingPayment.status = 'PENDING'
      await existingPayment.save()

      booking.paymentStatus = 'HOLD'
      await booking.save()

      return res.status(200).json({
        success: true,
        message: 'A payment request already exists for this trip',
        data: {
          payment: {
            id: existingPayment._id,
            tripId: existingPayment.tripId,
            bookingId: existingPayment.bookingId,
            status: existingPayment.status,
            amount: existingPayment.amount,
            currency: existingPayment.currency,
            merchantTransactionId: existingPayment.merchantTransactionId,
            actionUrl: rebuiltRequest.actionUrl,
            method: rebuiltRequest.method,
            fields: rebuiltRequest.fields
          },
          gateway: {
            name: 'PAYU',
            mode: rebuiltRequest.mode
          }
        }
      })
    }

    const buyer = {
      ...(booking.buyerId?.toObject ? booking.buyerId.toObject() : booking.buyerId),
      name:
        payerName ||
        booking.buyerId?.name ||
        booking.buyerId?.company ||
        'Marketplace Buyer',
      email: payerEmail || booking.buyerId?.email || '',
      mobile: payerPhone || booking.buyerId?.mobile || ''
    }

    if (!buyer.email) {
      return res.status(400).json({
        success: false,
        message: 'Buyer email is required to initiate PayU payment'
      })
    }

    const seller = booking.sellerId
    const merchantTransactionId = makeTransactionId()
    const session = await mongoose.startSession()
    session.startTransaction()

    try {
      const [payment] = await MarketplacePayment.create(
        [
          {
            publicId: `mp_${nanoid(12)}`,
            tripId: trip._id,
            bookingId: booking._id,
            payerTransporterId: buyer._id,
            beneficiaryTransporterId: seller._id,
            provider: 'PAYU',
            status: 'CREATED',
            amount: finalAmount,
            currency: 'INR',
            merchantTransactionId,
            paymentGatewayUrl: null,
            paymentRequest: {},
            initiatedBy: {
              userId: req.user.id || null,
              userType: req.user.userType || null
            },
            initiatedAt: new Date()
          }
        ],
        { session }
      )

      const paymentRequest = buildMarketplaceTripPaymentRequest({
        merchantTransactionId,
        amount: finalAmount,
        buyer,
        trip,
        booking,
        paymentId: payment._id,
        successUrl: payuSuccessUrl,
        failureUrl: payuFailureUrl
      })

      payment.paymentGatewayUrl = paymentRequest.actionUrl
      payment.paymentRequest = paymentRequest
      payment.status = 'PENDING'
      await payment.save({ session })

      booking.paymentStatus = 'HOLD'
      await booking.save({ session })

      await session.commitTransaction()
      session.endSession()

      return res.status(200).json({
        success: true,
        message: 'PayU payment request created successfully',
        data: {
          payment: {
            id: getPaymentPublicId(payment),
            paymentId: payment._id.toString(),
            publicId: getPaymentPublicId(payment),
            tripId: payment.tripId,
            bookingId: payment.bookingId,
            status: payment.status,
            amount: payment.amount,
            currency: payment.currency,
            merchantTransactionId: payment.merchantTransactionId,
            actionUrl: paymentRequest.actionUrl,
            method: paymentRequest.method,
            fields: paymentRequest.fields
          },
          gateway: {
            provider: 'PAYU',
            name: 'PayU',
            mode: paymentRequest.mode,
            actionUrl: paymentRequest.actionUrl,
            method: paymentRequest.method
          }
        }
      })
    } catch (error) {
      await session.abortTransaction()
      session.endSession()
      throw error
    }
    } catch (error) {
      next(error)
    }
  }

const handlePayuWebhook = async (req, res, next) => {
  try {
    const body = {
      ...(req.query || {}),
      ...(req.body || {})
    }
    const merchantTransactionId = String(body.txnid || body.merchantTransactionId || body.merchant_transaction_id || '').trim()
    const paymentId = String(body.udf1 || '').trim()

    if (!merchantTransactionId && !paymentId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction reference is required'
      })
    }

    let payment = null
    if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
      payment = await MarketplacePayment.findById(paymentId)
    }
    if (!payment && merchantTransactionId) {
      payment = await MarketplacePayment.findOne({ merchantTransactionId })
    }

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found'
      })
    }

    const incomingProviderTxnId = String(
      body.mihpayid || body.payuMoneyId || body.bank_ref_num || ''
    ).trim()

    if (
      payment.status === 'SUCCESS' &&
      (!incomingProviderTxnId ||
        !payment.providerTransactionId ||
        payment.providerTransactionId === incomingProviderTxnId)
    ) {
      return res.status(200).json({
        success: true,
        message: 'PayU webhook processed successfully'
      })
    }

    const responseStatus = normalizePayuStatus(body.status)
    const hashOk = verifyPayuResponseHash(body)

    if (!hashOk) {
      payment.status = 'FAILED'
      payment.failureReason = 'Invalid PayU response hash'
      payment.paymentResponse = { ...body, verified: false }
      payment.failedAt = new Date()
      await payment.save()

      return res.status(400).json({
        success: false,
        message: 'Invalid PayU response hash'
      })
    }

    payment.paymentResponse = { ...body, verified: true }
    payment.providerTransactionId = incomingProviderTxnId || payment.providerTransactionId
    payment.providerOrderId = body.bank_ref_num || body.pgTransactionId || payment.providerOrderId

    if (responseStatus === 'SUCCESS') {
      payment.status = 'SUCCESS'
      payment.completedAt = new Date()
      payment.failureReason = null
    } else if (responseStatus === 'CANCELLED') {
      payment.status = 'CANCELLED'
      payment.failedAt = new Date()
      payment.failureReason = body.error_Message || body.error || 'Payment cancelled'
    } else if (responseStatus === 'FAILED') {
      payment.status = 'FAILED'
      payment.failedAt = new Date()
      payment.failureReason = body.error_Message || body.error || 'Payment failed'
    } else {
      payment.status = 'PENDING'
    }

    await payment.save()

    const booking = await VehicleBooking.findById(payment.bookingId)
    if (booking) {
      if (payment.status === 'SUCCESS') {
        booking.paymentStatus = 'COMPLETED'
      } else if (payment.status === 'CANCELLED' || payment.status === 'FAILED') {
        booking.paymentStatus = 'PENDING'
      }
      await booking.save()
    }

    return res.status(200).json({
      success: true,
      message: 'PayU webhook processed successfully'
    })
  } catch (error) {
    next(error)
  }
}

const getMarketplaceTripPaymentStatus = async (req, res, next) => {
  try {
    const { tripId } = req.params
    const actorId = getTransporterActorId(req.user)
    const isAdmin = req.user?.userType === 'admin'

    const { trip, booking } = await getMarketplaceTripPaymentContext(tripId)

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    if (!isAdmin) {
      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Booking not found for this trip'
        })
      }

      const buyerId = toObjectIdString(booking.buyerId)
      const sellerId = toObjectIdString(booking.sellerId)

      if (!actorId || (actorId !== buyerId && actorId !== sellerId)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        })
      }

      if (req.user.userType === 'company-user') {
        const allowed = await canTransporterPartyViewTripExecution(req.user, trip)
        if (!allowed) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          })
        }
      }
    }

    const latestPayment = await getLatestPaymentForTrip(trip._id)
    const milestoneOneCompleted = Array.isArray(trip.milestones)
      ? trip.milestones.some((milestone) => milestone?.milestoneNumber === 1)
      : false

    return res.status(200).json({
      success: true,
      data: {
        trip: {
          id: trip._id,
          tripId: trip.tripId,
          status: trip.status,
          isFromBooking: trip.isFromBooking,
          bookingId: trip.bookingId,
          tripType: trip.tripType
        },
        booking: booking
          ? {
              id: booking._id,
              buyerId: booking.buyerId?._id || booking.buyerId,
              sellerId: booking.sellerId?._id || booking.sellerId,
              agreedPrice: booking.agreedPrice,
              paymentStatus: booking.paymentStatus
            }
          : null,
        payment: latestPayment,
        eligibility: {
          marketplaceTrip: isMarketplaceBookingTrip(trip),
          tripStarted: trip.status === 'ACTIVE',
          milestoneOneCompleted,
          canInitiatePayment:
            isMarketplaceBookingTrip(trip) &&
            trip.status === 'ACTIVE' &&
            milestoneOneCompleted &&
            booking &&
            booking.status === 'CONFIRMED' &&
            Number(booking.agreedPrice) > 0
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  initiateMarketplaceTripPayuPayment,
  handlePayuWebhook,
  getMarketplaceTripPaymentStatus
}
