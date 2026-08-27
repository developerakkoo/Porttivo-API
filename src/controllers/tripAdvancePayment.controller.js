const mongoose = require('mongoose')
const Trip = require('../models/Trip')
const PaymentSession = require('../models/PaymentSession')
const {
  verifyRazorpayPaymentSignatureNew
} = require('../services/paymentGateway.service')
const Driver = require('../models/Driver')
const Transporter = require('../models/Transporter')
const Payout = require('../models/Payout')

const {
  buildPaymentInitiationRequest,
  getProviderConfig,
  makeTransactionId,
  normalizeMoney,
  resolvePayerProfile
} = require('../services/paymentGateway.service')

const { isDriverPayoutReady } = require('../services/razorpayPayout.service')

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
        message: 'You are not authorized to pay advance for this trip'
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
        message: 'Advance amount is not configured for this trip'
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

    const payoutReadiness = await isDriverPayoutReady(trip.driverId.toString())

    if (!payoutReadiness?.ready) {
      return res.status(400).json({
        success: false,
        message: 'Driver is not ready to receive payout',

        reason: payoutReadiness?.reason || 'RAZORPAY_FUND_ACCOUNT_NOT_READY'
      })
    }

    // --------------------------------------------------
    // 8. Check already successful payment
    // --------------------------------------------------

    const existingSuccessfulPayment = await PaymentSession.findOne({
      referenceType: 'TRIP',
      referenceId: trip._id.toString(),
      purpose: 'DRIVER_ADVANCE',
      provider: 'RAZORPAY',
      status: 'SUCCESS'
    }).sort({ createdAt: -1 })

    if (existingSuccessfulPayment) {
      return res.status(200).json({
        success: true,
        message: 'Driver advance has already been paid',

        data: {
          alreadyPaid: true,

          paymentSessionId: existingSuccessfulPayment.publicId
        }
      })
    }

    // --------------------------------------------------
    // 9. Check existing pending payment
    // --------------------------------------------------

    const existingPendingPayment = await PaymentSession.findOne({
      referenceType: 'TRIP',
      referenceId: trip._id.toString(),
      purpose: 'DRIVER_ADVANCE',
      provider: 'RAZORPAY',
      status: {
        $in: ['CREATED', 'PENDING']
      }
    }).sort({ createdAt: -1 })

    if (existingPendingPayment && existingPendingPayment.providerOrderId) {
      const pendingFields =
        existingPendingPayment.paymentRequest?.fields || {}
      const pendingKeyId =
        pendingFields.key || gatewayConfig.keyId || null
      const pendingAmount =
        pendingFields.amount != null
          ? Number(pendingFields.amount)
          : Math.round(Number(existingPendingPayment.amount) * 100)

      return res.status(200).json({
        success: true,

        message: 'Existing Razorpay payment session found',

        data: {
          alreadyPaid: false,

          paymentSessionId: existingPendingPayment.publicId,

          razorpay: {
            keyId: pendingKeyId,

            orderId: existingPendingPayment.providerOrderId,

            amount: pendingAmount,

            currency:
              pendingFields.currency ||
              existingPendingPayment.currency ||
              'INR'
          }
        }
      })
    }

    // --------------------------------------------------
    // 10. Resolve payer
    // --------------------------------------------------

    const payer = resolvePayerProfile({}, req.user)

    // --------------------------------------------------
    // 11. Generate merchant transaction ID
    // --------------------------------------------------

    const merchantTransactionId = makeTransactionId('ADV')

    // --------------------------------------------------
    // 12. Create PaymentSession
    // --------------------------------------------------

    const payment = await PaymentSession.create({
      referenceType: 'TRIP',

      referenceId: trip._id.toString(),

      purpose: 'DRIVER_ADVANCE',

      provider: 'RAZORPAY',

      status: 'CREATED',

      amount: Number(normalizedAmount),

      currency: 'INR',

      merchantTransactionId,

      payer: {
        userId: payer.userId || trip.transporterId,

        userType: payer.userType || 'TRANSPORTER',

        name: payer.name || null,

        email: payer.email || null,

        mobile: payer.mobile || null
      },

      metadata: {
        tripId: trip._id.toString(),

        tripNumber: trip.tripId || null,

        transporterId: trip.transporterId?.toString() || null,

        driverId: trip.driverId?.toString() || null,

        purpose: 'DRIVER_ADVANCE',

        payout: {
          payeeId: trip.driverId.toString(),

          payeeType: 'DRIVER',

          transferMode: 'IMPS',

          currency: 'INR'
        }
      },

      initiatedBy: {
        userId: req.user?.id || null,

        userType: req.user?.userType || null
      },

      initiatedAt: new Date()
    })

    // --------------------------------------------------
    // 13. Create Razorpay Order
    // --------------------------------------------------

    const paymentRequest = await buildPaymentInitiationRequest({
      provider: 'RAZORPAY',

      merchantTransactionId,

      amount: normalizedAmount,

      currency: 'INR',

      payer: {
        userId: payer.userId || trip.transporterId,

        userType: payer.userType || 'TRANSPORTER',

        name: payer.name || null,

        email: payer.email || null,

        mobile: payer.mobile || null
      },

      reference: {
        referenceType: 'TRIP',

        referenceId: trip._id.toString(),

        purpose: 'DRIVER_ADVANCE'
      },

      paymentSessionId: payment._id,

      successUrl: null,

      failureUrl: null,

      metadata: payment.metadata
    })

    // --------------------------------------------------
    // 14. Extract Razorpay Order ID
    // --------------------------------------------------

    const razorpayOrderId =
      paymentRequest.rawResponse?.id || paymentRequest.fields?.order_id || null

    if (!razorpayOrderId) {
      throw new Error('Razorpay order ID was not returned')
    }

    // --------------------------------------------------
    // 15. Save Razorpay Order
    // --------------------------------------------------

    payment.providerOrderId = razorpayOrderId

    payment.paymentRequest = paymentRequest

    payment.status = 'PENDING'

    await payment.save()

    // --------------------------------------------------
    // 16. Response
    // --------------------------------------------------

    return res.status(200).json({
      success: true,

      message: 'Driver advance payment session created successfully',

      data: {
        paymentSessionId: payment.publicId,

        trip: {
          id: trip._id.toString(),

          tripId: trip.tripId || null,

          driverId: trip.driverId.toString(),

          advanceAmount: Number(normalizedAmount)
        },

        razorpay: {
          keyId:
            paymentRequest.fields?.key ||
            gatewayConfig.keyId ||
            null,

          orderId: razorpayOrderId,

          amount:
            paymentRequest.fields?.amount != null
              ? Number(paymentRequest.fields.amount)
              : Math.round(Number(normalizedAmount) * 100),

          currency:
            paymentRequest.fields?.currency || 'INR'
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

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
      req.body

    // ---------------------------------------------
    // 1. Validate request
    // ---------------------------------------------

    if (!mongoose.Types.ObjectId.isValid(tripId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid trip ID'
      })
    }

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
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

    const paymentSession = await PaymentSession.findOne({
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
        message: 'Razorpay payment session not found'
      })
    }

    // ---------------------------------------------
    // 4. Idempotency
    // ---------------------------------------------

    if (paymentSession.status === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        message: 'Driver advance payment already verified',
        data: {
          paymentSessionId: paymentSession.publicId,

          status: paymentSession.status,

          paymentId: paymentSession.providerTransactionId
        }
      })
    }

    // ---------------------------------------------
    // 5. IMPORTANT:
    // Use order ID from OUR database
    // ---------------------------------------------

    const orderId = paymentSession.providerOrderId

    // ---------------------------------------------
    // 6. Verify Razorpay signature
    // ---------------------------------------------

    const isValid = verifyRazorpayPaymentSignatureNew({
      orderId,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature
    })

    if (!isValid) {
      paymentSession.status = 'FAILED'

      paymentSession.failureReason = 'RAZORPAY_SIGNATURE_VERIFICATION_FAILED'

      paymentSession.failureMessage =
        'Razorpay payment signature verification failed'

      await paymentSession.save()

      return res.status(400).json({
        success: false,
        message: 'Razorpay payment verification failed'
      })
    }

    // ---------------------------------------------
    // 7. Save Razorpay payment information
    // ---------------------------------------------

    paymentSession.providerTransactionId = razorpay_payment_id

    paymentSession.providerOrderId = orderId

    paymentSession.providerSignature = razorpay_signature

    // ---------------------------------------------
    // 8. Mark PayIN successful
    // ---------------------------------------------

    paymentSession.status = 'SUCCESS'

    paymentSession.completedAt = new Date()

    await paymentSession.save()

    // ---------------------------------------------
    // 9. Response
    // ---------------------------------------------

    return res.status(200).json({
      success: true,

      message: 'Driver advance payment verified successfully',

      data: {
        paymentSessionId: paymentSession.publicId,

        tripId: trip._id.toString(),

        amount: paymentSession.amount,

        currency: paymentSession.currency,

        paymentId: razorpay_payment_id,

        orderId,

        paymentStatus: 'SUCCESS',

        payoutStatus: 'PENDING'
      }
    })
  } catch (error) {
    next(error)
  }
}

// const getTransporterTripAdvancePayments = async (req, res, next) => {
//   try {
//     const transporterId = String(req.user?.id || '')

//     if (!transporterId) {
//       return res.status(401).json({
//         success: false,
//         message: 'Authentication required'
//       })
//     }

//     // --------------------------------------------------
//     // Pagination
//     // --------------------------------------------------

//     const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)

//     const limit = Math.min(
//       Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
//       100
//     )

//     const skip = (page - 1) * limit

//     // --------------------------------------------------
//     // Optional filters
//     // --------------------------------------------------

//     const { paymentStatus, payoutStatus, advanceStatus } = req.query

//     // --------------------------------------------------
//     // 1. Get transporter trips
//     // --------------------------------------------------

//     const tripQuery = {
//       transporterId: transporterId
//     }

//     const [trips, total] = await Promise.all([
//       Trip.find(tripQuery)
//         .select(
//           [
//             '_id',
//             'tripId',
//             'transporterId',
//             'driverId',
//             'advanceAmount',
//             'status',
//             'tripType',
//             'pickupLocation',
//             'dropLocation',
//             'scheduledAt',
//             'createdAt',
//             'updatedAt'
//           ].join(' ')
//         )
//         .sort({ createdAt: -1 })
//         .skip(skip)
//         .limit(limit)
//         .lean(),

//       Trip.countDocuments(tripQuery)
//     ])

//     if (!trips.length) {
//       return res.status(200).json({
//         success: true,
//         message: 'Trip advance payment status fetched successfully',
//         data: {
//           trips: [],
//           pagination: {
//             page,
//             limit,
//             total: 0,
//             pages: 0
//           }
//         }
//       })
//     }

//     // --------------------------------------------------
//     // 2. Get driver IDs
//     // --------------------------------------------------

//     const driverIds = trips.map(trip => trip.driverId).filter(Boolean)

//     const drivers = await Driver.find({
//       _id: { $in: driverIds }
//     })
//       .select('_id name mobile status')
//       .lean()

//     const driverMap = new Map(
//       drivers.map(driver => [String(driver._id), driver])
//     )

//     // --------------------------------------------------
//     // 3. Get PaymentSessions
//     // --------------------------------------------------

//     const tripIds = trips.map(trip => String(trip._id))

//     const paymentSessions = await PaymentSession.find({
//       referenceType: 'TRIP',
//       referenceId: { $in: tripIds },
//       purpose: 'DRIVER_ADVANCE',
//       provider: 'RAZORPAY'
//     })
//       .sort({ createdAt: -1 })
//       .lean()

//     // --------------------------------------------------
//     // 4. Keep latest payment session per trip
//     // --------------------------------------------------

//     const paymentMap = new Map()

//     for (const payment of paymentSessions) {
//       const tripId = String(payment.referenceId)

//       if (!paymentMap.has(tripId)) {
//         paymentMap.set(tripId, payment)
//       }
//     }

//     // --------------------------------------------------
//     // 5. Get payouts
//     // --------------------------------------------------

//     const paymentIds = Array.from(paymentMap.values())
//       .map(payment => payment._id)
//       .filter(Boolean)

//     const payouts = paymentIds.length
//       ? await Payout.find({
//           paymentId: { $in: paymentIds },
//           provider: 'RAZORPAY'
//         })
//           .select(
//             [
//               '_id',
//               'paymentId',
//               'amount',
//               'currency',
//               'status',
//               'initiatedAt',
//               'startedAt',
//               'completedAt',
//               'lastWebhookAt',
//               'failure',
//               'razorpay.payoutId',
//               'razorpay.referenceId',
//               'razorpay.transferMode',
//               'razorpay.statusDetails'
//             ].join(' ')
//           )
//           .lean()
//       : []

//     // --------------------------------------------------
//     // 6. Map payout by PaymentSession
//     // --------------------------------------------------

//     const payoutMap = new Map()

//     for (const payout of payouts) {
//       const paymentId = String(payout.paymentId)

//       if (!payoutMap.has(paymentId)) {
//         payoutMap.set(paymentId, payout)
//       }
//     }

//     // --------------------------------------------------
//     // 7. Build response
//     // --------------------------------------------------

//     let result = trips.map(trip => {
//       const tripId = String(trip._id)

//       const payment = paymentMap.get(tripId) || null

//       const payout = payment ? payoutMap.get(String(payment._id)) || null : null

//       const paymentStatus = payment?.status || 'NOT_CREATED'

//       const payoutStatus = payout?.status || null

//       // ----------------------------------------------
//       // Calculate combined advance status
//       // ----------------------------------------------

//       let status = 'NOT_PAID'

//       if (!trip.advanceAmount || Number(trip.advanceAmount) <= 0) {
//         status = 'NO_ADVANCE'
//       } else if (!payment) {
//         status = 'NOT_PAID'
//       } else if (payment.status === 'CREATED' || payment.status === 'PENDING') {
//         status = 'PAYMENT_PENDING'
//       } else if (
//         payment.status === 'FAILED' ||
//         payment.status === 'CANCELLED'
//       ) {
//         status = 'PAYMENT_FAILED'
//       } else if (payment.status === 'SUCCESS') {
//         if (!payout) {
//           status = 'PAYOUT_PENDING'
//         } else if (payout.status === 'CREATED') {
//           status = 'PAYOUT_PENDING'
//         } else if (payout.status === 'PROCESSING') {
//           status = 'PAYOUT_PROCESSING'
//         } else if (payout.status === 'SUCCESS') {
//           status = 'PAID'
//         } else if (
//           payout.status === 'FAILED' ||
//           payout.status === 'CANCELLED'
//         ) {
//           status = 'PAYOUT_FAILED'
//         } else if (payout.status === 'RETRY_PENDING') {
//           status = 'PAYOUT_RETRY_PENDING'
//         }
//       }

//       const driver = trip.driverId
//         ? driverMap.get(String(trip.driverId)) || null
//         : null

//       return {
//         tripId: trip.tripId,
//         tripType: trip.tripType,
//         tripStatus: trip.status,

//         driver: driver
//           ? {
//               name: driver.name || null,
//               mobile: driver.mobile || null,
//             //   status: driver.status || null
//             }
//           : null,

//         advance: {
//           amount: Number(trip.advanceAmount || 0),
//         //   currency: payment?.currency || 'INR',

//           status,

//           payment: payment
//             ? {
//                 status: payment.status,
//                 paidAt: payment.completedAt || null
//               }
//             : {
//                 status: 'NOT_CREATED',
//                 paidAt: null
//               },

//           payout: payout
//             ? {
//                 status: payout.status,
//                 paidAt: payout.completedAt || null
//               }
//             : {
//                 status: null,
//                 paidAt: null
//               }
//         },

//         createdAt: trip.createdAt
//       }
//     })

//     // --------------------------------------------------
//     // 8. Optional filters
//     // --------------------------------------------------

//     if (paymentStatus) {
//       result = result.filter(
//         item =>
//           item.advance.paymentStatus === String(paymentStatus).toUpperCase()
//       )
//     }

//     if (payoutStatus) {
//       result = result.filter(
//         item => item.advance.payoutStatus === String(payoutStatus).toUpperCase()
//       )
//     }

//     if (advanceStatus) {
//       result = result.filter(
//         item => item.advance.status === String(advanceStatus).toUpperCase()
//       )
//     }

//     return res.status(200).json({
//       success: true,
//       message: 'Trip advance payment status fetched successfully',

//       data: {
//         trips: result,

//         pagination: {
//           page,
//           limit,
//           total,
//           pages: Math.ceil(total / limit)
//         }
//       }
//     })
//   } catch (error) {
//     next(error)
//   }
// }

const computeAdvanceStatus = (trip, payment, payout) => {
  if (!trip.advanceAmount || Number(trip.advanceAmount) <= 0) {
    return 'NO_ADVANCE'
  }
  if (!payment) {
    return 'NOT_PAID'
  }
  if (payment.status === 'CREATED' || payment.status === 'PENDING') {
    return 'PAYMENT_PENDING'
  }
  if (payment.status === 'FAILED' || payment.status === 'CANCELLED') {
    return 'PAYMENT_FAILED'
  }
  if (payment.status === 'SUCCESS') {
    if (!payout || payout.status === 'CREATED') {
      return 'PAYOUT_PENDING'
    }
    if (payout.status === 'PROCESSING') {
      return 'PAYOUT_PROCESSING'
    }
    if (payout.status === 'SUCCESS') {
      return 'PAID'
    }
    if (payout.status === 'FAILED' || payout.status === 'CANCELLED') {
      return 'PAYOUT_FAILED'
    }
    if (payout.status === 'RETRY_PENDING') {
      return 'PAYOUT_RETRY_PENDING'
    }
  }
  return 'NOT_PAID'
}

const buildTripAdvancePaymentRows = async ({
  trips,
  includeDriver = true,
  includeTransporter = false
}) => {
  if (!trips.length) {
    return []
  }

  const driverIds = trips.map(trip => trip.driverId).filter(Boolean)
  const transporterIds = trips.map(trip => trip.transporterId).filter(Boolean)

  const [drivers, transporters] = await Promise.all([
    includeDriver && driverIds.length
      ? Driver.find({ _id: { $in: driverIds } })
          .select('_id name mobile')
          .lean()
      : [],
    includeTransporter && transporterIds.length
      ? Transporter.find({ _id: { $in: transporterIds } })
          .select('_id name company mobile')
          .lean()
      : []
  ])

  const driverMap = new Map(
    (drivers || []).map(driver => [String(driver._id), driver])
  )
  const transporterMap = new Map(
    (transporters || []).map(transporter => [
      String(transporter._id),
      transporter
    ])
  )

  const tripIds = trips.map(trip => String(trip._id))

  const paymentSessions = await PaymentSession.find({
    referenceType: 'TRIP',
    referenceId: { $in: tripIds },
    purpose: 'DRIVER_ADVANCE',
    provider: 'RAZORPAY'
  })
    .sort({ createdAt: -1 })
    .lean()

  const paymentMap = new Map()
  for (const payment of paymentSessions) {
    const tripId = String(payment.referenceId)
    if (!paymentMap.has(tripId)) {
      paymentMap.set(tripId, payment)
    }
  }

  const paymentIds = Array.from(paymentMap.values())
    .map(payment => payment._id)
    .filter(Boolean)

  const payouts = paymentIds.length
    ? await Payout.find({
        paymentId: { $in: paymentIds },
        provider: 'RAZORPAY'
      })
        .select(
          [
            '_id',
            'paymentId',
            'amount',
            'currency',
            'status',
            'initiatedAt',
            'startedAt',
            'completedAt',
            'lastWebhookAt',
            'failure',
            'razorpay.payoutId',
            'razorpay.referenceId',
            'razorpay.transferMode'
          ].join(' ')
        )
        .lean()
    : []

  const payoutMap = new Map()
  for (const payout of payouts) {
    const paymentId = String(payout.paymentId)
    if (!payoutMap.has(paymentId)) {
      payoutMap.set(paymentId, payout)
    }
  }

  return trips.map(trip => {
    const tripObjectId = String(trip._id)
    const payment = paymentMap.get(tripObjectId) || null
    const payout = payment
      ? payoutMap.get(String(payment._id)) || null
      : null
    const paymentStatus = payment?.status || 'NOT_CREATED'
    const payoutStatus = payout?.status || null
    const advanceStatus = computeAdvanceStatus(trip, payment, payout)

    const driver = includeDriver && trip.driverId
      ? driverMap.get(String(trip.driverId)) || null
      : null
    const transporter = includeTransporter && trip.transporterId
      ? transporterMap.get(String(trip.transporterId)) || null
      : null

    return {
      trip: {
        id: tripObjectId,
        tripref: trip.tripId || null,
        type: trip.tripType || null,
        status: trip.status || null,
        createdAt: trip.createdAt
      },
      driver: driver
        ? {
            name: driver.name || null,
            mobile: driver.mobile || null
          }
        : null,
      transporter: transporter
        ? {
            name: transporter.name || transporter.company || null,
            company: transporter.company || null,
            mobile: transporter.mobile || null
          }
        : null,
      advance: {
        amount: Number(trip.advanceAmount || 0),
        currency: payment?.currency || 'INR',
        status: advanceStatus,
        payment: {
          status: paymentStatus,
          paidAt: payment?.completedAt || null
        },
        payout: {
          status: payoutStatus,
          paidAt: payout?.completedAt || null
        }
      }
    }
  })
}

const filterAdvancePaymentRows = (rows, query) => {
  const { paymentStatus, payoutStatus, advanceStatus } = query
  let result = rows

  if (paymentStatus) {
    const normalizedPaymentStatus = String(paymentStatus).toUpperCase()
    result = result.filter(
      item => item.advance.payment.status === normalizedPaymentStatus
    )
  }

  if (payoutStatus) {
    const normalizedPayoutStatus = String(payoutStatus).toUpperCase()
    result = result.filter(
      item => item.advance.payout.status === normalizedPayoutStatus
    )
  }

  if (advanceStatus) {
    const normalizedAdvanceStatus = String(advanceStatus).toUpperCase()
    result = result.filter(
      item => item.advance.status === normalizedAdvanceStatus
    )
  }

  return result
}

const getTransporterTripAdvancePayments = async (req, res, next) => {
  try {
    const transporterId = String(req.user?.id || '')

    if (!transporterId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      })
    }

    // --------------------------------------------------
    // Pagination
    // --------------------------------------------------

    const page = Math.max(
      Number.parseInt(req.query.page, 10) || 1,
      1
    )

    const limit = Math.min(
      Math.max(
        Number.parseInt(req.query.limit, 10) || 20,
        1
      ),
      100
    )

    const skip = (page - 1) * limit

    // --------------------------------------------------
    // Optional filters
    // --------------------------------------------------

    const {
      paymentStatus,
      payoutStatus,
      advanceStatus
    } = req.query

    // --------------------------------------------------
    // 1. Get transporter trips
    // --------------------------------------------------

    const tripQuery = {
      transporterId
    }

    const [trips, total] = await Promise.all([
      Trip.find(tripQuery)
        .select(
          [
            '_id',
            'tripId',
            'transporterId',
            'driverId',
            'advanceAmount',
            'status',
            'tripType',
            'scheduledAt',
            'createdAt'
          ].join(' ')
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      Trip.countDocuments(tripQuery)
    ])

    if (!trips.length) {
      return res.status(200).json({
        success: true,
        message: 'Trip advance payment status fetched successfully',

        data: {
          trips: [],

          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        }
      })
    }

    const rows = await buildTripAdvancePaymentRows({
      trips,
      includeDriver: true,
      includeTransporter: false
    })

    const result = filterAdvancePaymentRows(rows, req.query)

    return res.status(200).json({
      success: true,
      message: 'Trip advance payment status fetched successfully',
      data: {
        trips: result,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    })
  } catch (error) {
    next(error)
  }
}

const getDriverTripAdvancePayments = async (req, res, next) => {
  try {
    const driverId = String(req.user?.id || '')

    if (!driverId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      })
    }

    const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1)
    const limit = Math.min(
      Math.max(Number.parseInt(req.query.limit, 10) || 20, 1),
      100
    )
    const skip = (page - 1) * limit

    const tripQuery = { driverId }

    const [trips, total] = await Promise.all([
      Trip.find(tripQuery)
        .select(
          [
            '_id',
            'tripId',
            'transporterId',
            'driverId',
            'advanceAmount',
            'status',
            'tripType',
            'scheduledAt',
            'createdAt'
          ].join(' ')
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Trip.countDocuments(tripQuery)
    ])

    if (!trips.length) {
      return res.status(200).json({
        success: true,
        message: 'Trip advance payment status fetched successfully',
        data: {
          trips: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        }
      })
    }

    const rows = await buildTripAdvancePaymentRows({
      trips,
      includeDriver: false,
      includeTransporter: true
    })

    const result = filterAdvancePaymentRows(rows, req.query)

    return res.status(200).json({
      success: true,
      message: 'Trip advance payment status fetched successfully',
      data: {
        trips: result,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    })
  } catch (error) {
    next(error)
  }
}


module.exports = {
  createTripAdvancePayment,
  verifyTripAdvancePayment,
  getTransporterTripAdvancePayments,
  getDriverTripAdvancePayments
}
