const mongoose = require('mongoose')
const Trip = require('../models/Trip')
const PaymentSession = require('../models/PaymentSession')
const { verifyRazorpayPaymentSignatureNew } = require('../services/paymentGateway.service')

const {
  buildPaymentInitiationRequest,
  getProviderConfig,
  makeTransactionId,
  normalizeMoney,
  resolvePayerProfile
} = require('../services/paymentGateway.service')

const {
  isDriverPayoutReady
} = require('../services/razorpayPayout.service')

const createTripAdvancePayment = async (req, res, next) => {
  try {
    const { tripId } = req.params

    // --------------------------------------------------
    // 1. Validate trip ID
    // --------------------------------------------------

    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trip ID'
      })
    }

    // --------------------------------------------------
    // 2. Get trip
    // --------------------------------------------------

    const trip = await Trip.findById(tripId)

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    // --------------------------------------------------
    // 3. Verify transporter ownership
    // --------------------------------------------------

    const loggedInUserId = String(req.user?.id || '')

    if (
      req.user?.userType !== 'ADMIN' &&
      String(trip.transporterId || '') !== loggedInUserId
    ) {
      return res.status(403).json({
        success: false,
        message:
          'You are not authorized to pay advance for this trip'
      })
    }

    // --------------------------------------------------
    // 4. Driver validation
    // --------------------------------------------------

    if (!trip.driverId) {
      return res.status(400).json({
        success: false,
        message: 'No driver is assigned to this trip'
      })
    }

    // --------------------------------------------------
    // 5. Advance amount validation
    // --------------------------------------------------

    const amount = Number(trip.advanceAmount || 0)

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message:
          'Advance amount is not configured for this trip'
      })
    }

    const normalizedAmount = normalizeMoney(amount)

    // --------------------------------------------------
    // 6. Razorpay configuration
    // --------------------------------------------------

    const provider = 'RAZORPAY'

    const gatewayConfig = getProviderConfig(provider)

    if (!gatewayConfig?.configured) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay is not configured'
      })
    }

    // --------------------------------------------------
    // 7. Driver payout readiness
    // --------------------------------------------------

    const payoutReadiness =
      await isDriverPayoutReady(
        trip.driverId.toString()
      )

    if (!payoutReadiness?.ready) {
      return res.status(400).json({
        success: false,
        message:
          'Driver is not ready to receive payout',

        reason:
          payoutReadiness?.reason ||
          'RAZORPAY_FUND_ACCOUNT_NOT_READY'
      })
    }

    // --------------------------------------------------
    // 8. Check already successful payment
    // --------------------------------------------------

    const existingSuccessfulPayment =
      await PaymentSession.findOne({
        referenceType: 'TRIP',
        referenceId: trip._id.toString(),
        purpose: 'DRIVER_ADVANCE',
        provider: 'RAZORPAY',
        status: 'SUCCESS'
      }).sort({ createdAt: -1 })

    if (existingSuccessfulPayment) {
      return res.status(200).json({
        success: true,
        message:
          'Driver advance has already been paid',

        data: {
          alreadyPaid: true,

          paymentSessionId:
            existingSuccessfulPayment.publicId
        }
      })
    }

    // --------------------------------------------------
    // 9. Check existing pending payment
    // --------------------------------------------------

    const existingPendingPayment =
      await PaymentSession.findOne({
        referenceType: 'TRIP',
        referenceId: trip._id.toString(),
        purpose: 'DRIVER_ADVANCE',
        provider: 'RAZORPAY',
        status: {
          $in: ['CREATED', 'PENDING']
        }
      }).sort({ createdAt: -1 })

    if (
      existingPendingPayment &&
      existingPendingPayment.providerOrderId
    ) {
      return res.status(200).json({
        success: true,

        message:
          'Existing Razorpay payment session found',

        data: {
          alreadyPaid: false,

          paymentSessionId:
            existingPendingPayment.publicId,

          razorpay: {
            keyId:
              gatewayConfig.keyId,

            orderId:
              existingPendingPayment.providerOrderId,

            amount:
              Math.round(
                Number(existingPendingPayment.amount) * 100
              ),

            currency:
              existingPendingPayment.currency || 'INR'
          }
        }
      })
    }

    // --------------------------------------------------
    // 10. Resolve payer
    // --------------------------------------------------

    const payer =
      resolvePayerProfile({}, req.user)

    // --------------------------------------------------
    // 11. Generate merchant transaction ID
    // --------------------------------------------------

    const merchantTransactionId =
      makeTransactionId('ADV')

    // --------------------------------------------------
    // 12. Create PaymentSession
    // --------------------------------------------------

    const payment =
      await PaymentSession.create({

        referenceType: 'TRIP',

        referenceId:
          trip._id.toString(),

        purpose:
          'DRIVER_ADVANCE',

        provider:
          'RAZORPAY',

        status:
          'CREATED',

        amount:
          Number(normalizedAmount),

        currency:
          'INR',

        merchantTransactionId,

        payer: {
          userId:
            payer.userId ||
            trip.transporterId,

          userType:
            payer.userType ||
            'TRANSPORTER',

          name:
            payer.name || null,

          email:
            payer.email || null,

          mobile:
            payer.mobile || null
        },

        metadata: {

          tripId:
            trip._id.toString(),

          tripNumber:
            trip.tripId || null,

          transporterId:
            trip.transporterId?.toString() || null,

          driverId:
            trip.driverId?.toString() || null,

          purpose:
            'DRIVER_ADVANCE',

          payout: {

            payeeId:
              trip.driverId.toString(),

            payeeType:
              'DRIVER',

            transferMode:
              'IMPS',

            currency:
              'INR'
          }
        },

        initiatedBy: {

          userId:
            req.user?.id || null,

          userType:
            req.user?.userType || null
        },

        initiatedAt:
          new Date()
      })

    // --------------------------------------------------
    // 13. Create Razorpay Order
    // --------------------------------------------------

    const paymentRequest =
      await buildPaymentInitiationRequest({

        provider:
          'RAZORPAY',

        merchantTransactionId,

        amount:
          normalizedAmount,

        currency:
          'INR',

        payer: {

          userId:
            payer.userId ||
            trip.transporterId,

          userType:
            payer.userType ||
            'TRANSPORTER',

          name:
            payer.name || null,

          email:
            payer.email || null,

          mobile:
            payer.mobile || null
        },

        reference: {

          referenceType:
            'TRIP',

          referenceId:
            trip._id.toString(),

          purpose:
            'DRIVER_ADVANCE'
        },

        paymentSessionId:
          payment._id,

        successUrl:
          null,

        failureUrl:
          null,

        metadata:
          payment.metadata
      })

    // --------------------------------------------------
    // 14. Extract Razorpay Order ID
    // --------------------------------------------------

    const razorpayOrderId =
      paymentRequest.rawResponse?.id ||
      paymentRequest.fields?.order_id ||
      null

    if (!razorpayOrderId) {
      throw new Error(
        'Razorpay order ID was not returned'
      )
    }

    // --------------------------------------------------
    // 15. Save Razorpay Order
    // --------------------------------------------------

    payment.providerOrderId =
      razorpayOrderId

    payment.paymentRequest =
      paymentRequest

    payment.status =
      'PENDING'

    await payment.save()

    // --------------------------------------------------
    // 16. Response
    // --------------------------------------------------

    return res.status(200).json({

      success: true,

      message:
        'Driver advance payment session created successfully',

      data: {

        paymentSessionId:
          payment.publicId,

        trip: {

          id:
            trip._id.toString(),

          tripId:
            trip.tripId || null,

          driverId:
            trip.driverId.toString(),

          advanceAmount:
            Number(normalizedAmount)
        },

        razorpay: {

          keyId:
            gatewayConfig.keyId,

          orderId:
            razorpayOrderId,

          amount:
            Math.round(
              Number(normalizedAmount) * 100
            ),

          currency:
            'INR'
        }
      }
    })

  } catch (error) {
    next(error)
  }
}





const verifyTripAdvancePayment = async (req, res, next) => {
  try {
    const { tripId } = req.params

    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature
    } = req.body

    // ---------------------------------------------
    // 1. Validate request
    // ---------------------------------------------

    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trip ID'
      })
    }

    if (
      !razorpay_payment_id ||
      !razorpay_order_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message:
          'razorpay_payment_id, razorpay_order_id and razorpay_signature are required'
      })
    }

    // ---------------------------------------------
    // 2. Get trip
    // ---------------------------------------------

    const trip = await Trip.findById(tripId)

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      })
    }

    // ---------------------------------------------
    // 3. Find our PaymentSession
    // ---------------------------------------------

    const paymentSession =
      await PaymentSession.findOne({
        referenceType: 'TRIP',
        referenceId: trip._id.toString(),
        purpose: 'DRIVER_ADVANCE',
        provider: 'RAZORPAY',
        providerOrderId: razorpay_order_id
      }).sort({
        createdAt: -1
      })

    if (!paymentSession) {
      return res.status(404).json({
        success: false,
        message:
          'Razorpay payment session not found'
      })
    }

    // ---------------------------------------------
    // 4. Idempotency
    // ---------------------------------------------

    if (paymentSession.status === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        message:
          'Driver advance payment already verified',
        data: {
          paymentSessionId:
            paymentSession.publicId,

          status:
            paymentSession.status,

          paymentId:
            paymentSession.providerTransactionId
        }
      })
    }

    // ---------------------------------------------
    // 5. IMPORTANT:
    // Use order ID from OUR database
    // ---------------------------------------------

    const orderId =
      paymentSession.providerOrderId

    // ---------------------------------------------
    // 6. Verify Razorpay signature
    // ---------------------------------------------

    const isValid =
      verifyRazorpayPaymentSignatureNew({
        orderId,
        paymentId:
          razorpay_payment_id,
        signature:
          razorpay_signature
      })

    if (!isValid) {
      paymentSession.status = 'FAILED'

      paymentSession.failureReason =
        'RAZORPAY_SIGNATURE_VERIFICATION_FAILED'

      paymentSession.failureMessage =
        'Razorpay payment signature verification failed'

      await paymentSession.save()

      return res.status(400).json({
        success: false,
        message:
          'Razorpay payment verification failed'
      })
    }

    // ---------------------------------------------
    // 7. Save Razorpay payment information
    // ---------------------------------------------

    paymentSession.providerTransactionId =
      razorpay_payment_id

    paymentSession.providerOrderId =
      orderId

    paymentSession.providerSignature =
      razorpay_signature

    // ---------------------------------------------
    // 8. Mark PayIN successful
    // ---------------------------------------------

    paymentSession.status = 'SUCCESS'

    paymentSession.completedAt =
      new Date()

    await paymentSession.save()

    // ---------------------------------------------
    // 9. Response
    // ---------------------------------------------

    return res.status(200).json({
      success: true,

      message:
        'Driver advance payment verified successfully',

      data: {
        paymentSessionId:
          paymentSession.publicId,

        tripId:
          trip._id.toString(),

        amount:
          paymentSession.amount,

        currency:
          paymentSession.currency,

        paymentId:
          razorpay_payment_id,

        orderId,

        paymentStatus:
          'SUCCESS',

        payoutStatus:
          'PENDING'
      }
    })

  } catch (error) {
    next(error)
  }
}



module.exports = {
  createTripAdvancePayment,
  verifyTripAdvancePayment
}