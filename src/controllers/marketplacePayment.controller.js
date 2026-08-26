const crypto = require('crypto')
const mongoose = require('mongoose')
const { nanoid } = require('nanoid')
const Trip = require('../models/Trip')
const VehicleBooking = require('../models/VehicleBooking')
const MarketplacePayment = require('../models/MarketplacePayment')
const Notification = require('../models/Notification')
const { getTransporterActorId } = require('../utils/transporterActor')
const logger = require('../utils/logger')
const {
  canTransporterPartyViewTripExecution,
  isMarketplaceBookingTrip
} = require('../services/tripAccess.service')
const {
  getGatewayPayloadMetadata,
  verifyGatewayWebhook
} = require('../services/paymentGateway.service')
const {
  createAutomaticPayoutForPayment
} = require('../services/cashfreePayout.service')
const {
  createMarketplacePaymentRequestForTrip
} = require('../services/marketplacePayment.service')

const Payout = require('../models/Payout')
const toObjectIdString = value => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString ? value.toString() : String(value)
}

const getPaymentPublicId = payment => {
  if (!payment) return null
  return payment.publicId || (payment._id ? payment._id.toString() : null)
}

const getMarketplaceTripPaymentContext = async tripId => {
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

const getLatestPaymentForTrip = async tripId => {
  return MarketplacePayment.findOne({ tripId }).sort({ createdAt: -1 }).lean()
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
    ? trip.milestones.some(milestone => milestone?.milestoneNumber === 1)
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

const initiateMarketplaceTripRazorpayPayment = async (req, res, next) => {
  try {
    const { tripId } = req.params
    const { payerName, payerEmail, payerPhone } = req.body || {}
    const context = await assertMarketplacePayableTrip(tripId, req.user)

    if (context.error) {
      return res.status(context.statusCode || 400).json({
        success: false,
        message: context.error
      })
    }

    const { trip, booking } = context

    const payment = await createMarketplacePaymentRequestForTrip({
      trip,
      booking,
      initiatedBy: {
        userId: req.user.id || null,
        userType: req.user.userType || null
      },
      payerOverrides: {
        name: payerName,
        email: payerEmail,
        mobile: payerPhone
      }
    })

    if (payment.status === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        message: 'Payment has already been completed for this trip',
        data: {
          payment
        }
      })
    }

    const requestFields = payment.paymentRequest?.fields || {}
    if (!requestFields.order_id || !payment.paymentRequest?.actionUrl) {
      return res.status(500).json({
        success: false,
        message: 'Unable to create Razorpay checkout request'
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Razorpay payment request created successfully',
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
          providerOrderId:
            payment.providerOrderId || requestFields.order_id || null,
          actionUrl: payment.paymentRequest.actionUrl,
          method: payment.paymentRequest.method,
          fields: payment.paymentRequest.fields
        },
        gateway: {
          provider: 'RAZORPAY',
          name: 'Razorpay',
          mode: payment.paymentRequest.mode,
          actionUrl: payment.paymentRequest.actionUrl,
          method: payment.paymentRequest.method
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

const handleMarketplaceRazorpayWebhook = async (req, res, next) => {
  const requestId = crypto.randomUUID()

  try {
    const body = {
      ...(req.query || {}),
      ...(req.body || {})
    }
    const gatewayMetadata = getGatewayPayloadMetadata('RAZORPAY', body)
    const orderId = String(
      gatewayMetadata.providerOrderId ||
        body.razorpay_order_id ||
        body.order_id ||
        body.orderId ||
        body.txnid ||
        body.merchantTransactionId ||
        body.merchant_transaction_id ||
        ''
    ).trim()
    const paymentEntity =
      body.payload?.payment?.entity ||
      (body.payment && typeof body.payment === 'object' ? body.payment.entity || body.payment : null) ||
      {}
    const notes =
      paymentEntity.notes && typeof paymentEntity.notes === 'object'
        ? paymentEntity.notes
        : {}
    const paymentId = String(
      notes.paymentSessionId ||
        body.udf1 ||
        body.paymentSessionId ||
        ''
    ).trim()

    logger.info(`[${requestId}] Marketplace Razorpay webhook received`, {
      orderId,
      paymentId,
      bodyKeys: Object.keys(body || {})
    })

    if (!orderId && !paymentId) {
      logger.warn(
        `[${requestId}] Marketplace Razorpay webhook missing transaction reference`
      )
      return res.status(400).json({
        success: false,
        message: 'Transaction reference is required'
      })
    }

    let payment = null
    if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
      payment = await MarketplacePayment.findById(paymentId)
    }
    if (!payment && orderId) {
      payment = await MarketplacePayment.findOne({ providerOrderId: orderId })
    }
    if (!payment && body.txnid) {
      payment = await MarketplacePayment.findOne({
        merchantTransactionId: String(body.txnid).trim()
      })
    }

    if (!payment) {
      logger.warn(`[${requestId}] Marketplace payment record not found`, {
        orderId,
        paymentId
      })
      return res.status(200).json({
        success: true,
        message: 'Webhook received'
      })
    }

    const signatureOk = verifyGatewayWebhook({
      provider: 'RAZORPAY',
      body,
      headers: req.headers || {},
      rawBody: req.rawBody || ''
    })
    const incomingProviderTxnId = String(
      gatewayMetadata.providerTransactionId ||
        body.razorpay_payment_id ||
        body.payment_id ||
        ''
    ).trim()

    logger.info(`[${requestId}] Marketplace payment found`, {
      paymentId: payment._id.toString(),
      currentStatus: payment.status
    })

    if (
      payment.status === 'SUCCESS' &&
      (!incomingProviderTxnId ||
        !payment.providerTransactionId ||
        payment.providerTransactionId === incomingProviderTxnId)
    ) {
      logger.info(
        `[${requestId}] Duplicate Razorpay success notification ignored`,
        {
          paymentId: payment._id.toString()
        }
      )
      return res.status(200).json({
        success: true,
        message: 'Marketplace Razorpay webhook processed successfully'
      })
    }

    const responseStatus =
      gatewayMetadata.status === 'PENDING' &&
      signatureOk &&
      (body.razorpay_payment_id || incomingProviderTxnId)
        ? 'SUCCESS'
        : gatewayMetadata.status

    logger.info(`[${requestId}] Marketplace Razorpay webhook verification`, {
      signatureOk,
      status: responseStatus
    })

    if (!signatureOk) {
      payment.status = 'FAILED'
      payment.failureReason = 'Invalid Razorpay response signature'
      payment.paymentResponse = { ...body, verified: false }
      payment.failedAt = new Date()
      await payment.save()

      logger.error(
        `[${requestId}] Marketplace Razorpay webhook failed verification`,
        {
          paymentId: payment._id.toString()
        }
      )

      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay response signature'
      })
    }

    const previousStatus = payment.status

    payment.paymentResponse = { ...body, verified: true }
    payment.providerTransactionId =
      incomingProviderTxnId || payment.providerTransactionId
    payment.providerOrderId =
      gatewayMetadata.providerOrderId || payment.providerOrderId

    if (responseStatus === 'SUCCESS') {
      payment.status = 'SUCCESS'
      payment.completedAt = new Date()
      payment.failureReason = null
    } else if (responseStatus === 'CANCELLED') {
      payment.status = 'CANCELLED'
      payment.failedAt = new Date()
      payment.failureReason =
        body.error_Message || body.error || 'Payment cancelled'
    } else if (responseStatus === 'FAILED') {
      payment.status = 'FAILED'
      payment.failedAt = new Date()
      payment.failureReason =
        body.error_Message || body.error || 'Payment failed'
    } else {
      payment.status = 'PENDING'
    }

    await payment.save()

    const booking = await VehicleBooking.findById(payment.bookingId)
    if (booking) {
      if (payment.status === 'SUCCESS') {
        booking.paymentStatus = 'COMPLETED'
      } else if (
        payment.status === 'CANCELLED' ||
        payment.status === 'FAILED'
      ) {
        booking.paymentStatus = 'PENDING'
      }
      await booking.save()
    }

    if (previousStatus !== 'SUCCESS' && payment.status === 'SUCCESS') {
      logger.info(`[${requestId}] Marketplace payment success`, {
        paymentId: payment._id.toString(),
        merchantTransactionId: payment.merchantTransactionId,
        amount: payment.amount
      })

      try {
        logger.info('Payment metadata', {
          paymentId: payment._id.toString(),
          metadata: payment.metadata
        })
        const payout = await createAutomaticPayoutForPayment(payment, {
          fetchImpl: req.fetch || global.fetch
        })

        if (payout) {
          const payoutTransferId =
            payout.provider === 'RAZORPAY'
              ? payout.razorpay?.payoutId || null
              : payout.cashfree?.transferId || null
          const payoutReferenceId =
            payout.provider === 'RAZORPAY'
              ? payout.razorpay?.referenceId || null
              : payout.cashfree?.referenceId || null

          payment.metadata = {
            ...(payment.metadata || {}),
            payout: {
              id: payout._id?.toString() || null,
              provider: payout.provider || payment.provider || null,
              status: payout.status,
              transferId: payoutTransferId,
              referenceId: payoutReferenceId
            }
          }
          await payment.save()

          logger.info(`[${requestId}] Razorpay payout initiated`, {
            paymentId: payment._id.toString(),
            payoutId: payout._id?.toString(),
            payoutStatus: payout.status
          })
        }
      } catch (payoutError) {
        logger.error(`[${requestId}] Razorpay payout initiation failed`, {
          paymentId: payment._id.toString(),
          message: payoutError.message,
          stack: payoutError.stack
        })
      }

      try {
        await Notification.create({
          userId: payment.payerTransporterId,
          userType: 'TRANSPORTER',
          type: 'SYSTEM',
          title: 'Marketplace payment successful',
          message: `Your payment of ₹${payment.amount.toFixed(2)} for booking ${
            payment.bookingId
          } has been received successfully. Final disbursement is now in progress.`,
          data: {
            event: 'MARKETPLACE_PAYMENT_SUCCESS',
            tripId: payment.tripId,
            bookingId: payment.bookingId,
            paymentId: payment._id.toString(),
            amount: payment.amount
          },
          priority: 'high'
        })
      } catch (notificationError) {
        logger.warn(`[${requestId}] Notification save failed`, {
          paymentId: payment._id.toString(),
          message: notificationError.message
        })
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Marketplace Razorpay webhook processed successfully'
    })
  } catch (error) {
    logger.error(
      `[${crypto.randomUUID()}] Marketplace Razorpay webhook error`,
      {
        message: error.message,
        stack: error.stack
      }
    )
    next(error)
  }
}

// const getMarketplaceTripPaymentStatus = async (req, res, next) => {
//   try {
//     const { tripId } = req.params
//     const actorId = getTransporterActorId(req.user)
//     const isAdmin = req.user?.userType === 'admin'

//     const { trip, booking } = await getMarketplaceTripPaymentContext(tripId)

//     if (!trip) {
//       return res.status(404).json({
//         success: false,
//         message: 'Trip not found'
//       })
//     }

//     if (!isAdmin) {
//       if (!booking) {
//         return res.status(404).json({
//           success: false,
//           message: 'Booking not found for this trip'
//         })
//       }

//       const buyerId = toObjectIdString(booking.buyerId)
//       const sellerId = toObjectIdString(booking.sellerId)

//       if (!actorId || (actorId !== buyerId && actorId !== sellerId)) {
//         return res.status(403).json({
//           success: false,
//           message: 'Access denied'
//         })
//       }

//       if (req.user.userType === 'company-user') {
//         const allowed = await canTransporterPartyViewTripExecution(
//           req.user,
//           trip
//         )
//         if (!allowed) {
//           return res.status(403).json({
//             success: false,
//             message: 'Access denied'
//           })
//         }
//       }
//     }

//     const latestPayment = await getLatestPaymentForTrip(trip._id)
//     const milestoneOneCompleted = Array.isArray(trip.milestones)
//       ? trip.milestones.some(milestone => milestone?.milestoneNumber === 1)
//       : false

//     return res.status(200).json({
//       success: true,
//       data: {
//         trip: {
//           id: trip._id,
//           tripId: trip.tripId,
//           status: trip.status,
//           isFromBooking: trip.isFromBooking,
//           bookingId: trip.bookingId,
//           tripType: trip.tripType
//         },
//         booking: booking
//           ? {
//               id: booking._id,
//               buyerId: booking.buyerId?._id || booking.buyerId,
//               sellerId: booking.sellerId?._id || booking.sellerId,
//               agreedPrice: booking.agreedPrice,
//               paymentStatus: booking.paymentStatus
//             }
//           : null,
//         payment: latestPayment,
//         eligibility: {
//           marketplaceTrip: isMarketplaceBookingTrip(trip),
//           tripStarted: trip.status === 'ACTIVE',
//           milestoneOneCompleted,
//           paymentStatus: latestPayment?.status || booking?.paymentStatus || 'PENDING',
//           canInitiatePayment:
//             isMarketplaceBookingTrip(trip) &&
//             trip.status === 'ACTIVE' &&
//             milestoneOneCompleted &&
//             booking &&
//             booking.status === 'CONFIRMED' &&
//             Number(booking.agreedPrice) > 0 &&
//             (latestPayment?.status || booking?.paymentStatus || 'PENDING') !==
//               'SUCCESS'
//         }
//       }
//     })
//   } catch (error) {
//     next(error)
//   }
// }

const getMarketplaceTripPaymentStatus = async (req, res, next) => {
  try {
    const { tripId } = req.params
    const actorId = getTransporterActorId(req.user)
    const isAdmin = req.user?.userType === 'admin'

    const { trip, booking } = await getMarketplaceTripPaymentContext(tripId)

    // --------------------------------------------------
    // 1. Trip validation
    // --------------------------------------------------
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    // --------------------------------------------------
    // 2. Authorization
    // --------------------------------------------------
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
        const allowed = await canTransporterPartyViewTripExecution(
          req.user,
          trip
        )

        if (!allowed) {
          return res.status(403).json({
            success: false,
            message: 'Access denied'
          })
        }
      }
    }

    // --------------------------------------------------
    // 3. Get latest payment
    // --------------------------------------------------
    const latestPayment = await getLatestPaymentForTrip(trip._id)

    // --------------------------------------------------
    // 4. Get current payout
    // --------------------------------------------------
    let latestPayout = null

    if (latestPayment?._id) {
      latestPayout = await Payout.findOne({
        paymentId: latestPayment._id
      })
        .sort({ createdAt: -1 })
        .lean()
    }

    // --------------------------------------------------
    // 5. Milestone 1
    // --------------------------------------------------
    const milestoneOneCompleted = Array.isArray(trip.milestones)
      ? trip.milestones.some(milestone => milestone?.milestoneNumber === 1)
      : false

    // --------------------------------------------------
    // 6. Payment status
    // --------------------------------------------------
    const paymentStatus =
      latestPayment?.status ||
      (booking?.paymentStatus === 'COMPLETED'
        ? 'SUCCESS'
        : booking?.paymentStatus) ||
      'PENDING'

    // --------------------------------------------------
    // 7. Payout status
    // --------------------------------------------------
    const payoutStatus = latestPayout?.status || null

    // --------------------------------------------------
    // 8. Duplicate payment protection
    // --------------------------------------------------

    // Does an actual payment document exist?
    const hasPayment = !!latestPayment

    // Block duplicate checkout only after gateway submission or success.
    // PENDING = order created, buyer may still open Razorpay.
    const paymentBlockingInitiate =
      hasPayment && ['PROCESSING', 'SUCCESS'].includes(paymentStatus)

    const canInitiatePayment =
      isMarketplaceBookingTrip(trip) &&
      trip.status === 'ACTIVE' &&
      milestoneOneCompleted &&
      !!booking &&
      booking.status === 'CONFIRMED' &&
      Number(booking.agreedPrice) > 0 &&
      !paymentBlockingInitiate

    // --------------------------------------------------
    // 9. Frontend-friendly response
    // --------------------------------------------------
    return res.status(200).json({
      success: true,

      data: {
        trip: {
          id: trip._id,
          tripId: trip.tripId,
          status: trip.status,
          tripType: trip.tripType
        },

        booking: booking
          ? {
              id: booking._id,
              status: booking.status,
              agreedPrice: booking.agreedPrice,
              currency: 'INR',
              paymentStatus: booking.paymentStatus
            }
          : null,

        payment: latestPayment
          ? {
              id: latestPayment.publicId || latestPayment._id,
              status: paymentStatus,
              amount: latestPayment.amount,
              currency: latestPayment.currency,
              provider: latestPayment.provider
            }
          : null,

        payout: latestPayout
          ? {
              status: payoutStatus
            }
          : null,

        eligibility: {
          marketplaceTrip: isMarketplaceBookingTrip(trip),

          tripStarted: trip.status === 'ACTIVE',

          milestoneOneCompleted,

          paymentStatus,

          canInitiatePayment
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  initiateMarketplaceTripRazorpayPayment,
  handleMarketplaceRazorpayWebhook,
  getMarketplaceTripPaymentStatus
}
