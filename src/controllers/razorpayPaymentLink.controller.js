const crypto = require('crypto')

const Transporter = require('../models/Transporter')
const RazorpayPaymentLink = require('../models/RazorpayPaymentLink')

const {
  createPaymentLinkWithTransfer,
  fetchPaymentLink,
  cancelPaymentLink,
  makeReferenceId
} = require('../services/razorpayRoute.service')

const {
  getTransporterActorId
} = require('../utils/transporterActor')

const logger = require('../utils/logger')

const safeId = value => {
  if (!value) return null

  if (typeof value === 'string') {
    return value
  }

  if (value._id) {
    return value._id.toString()
  }

  return value.toString()
}

const normalizeCustomer = transporter => ({
  name:
    transporter?.name ||
    transporter?.company ||
    'Porttivo Transporter',

  email:
    String(transporter?.email || '')
      .trim()
      .toLowerCase() || undefined,

  contact:
    transporter?.mobile ||
    undefined
})

/**
 * Transporter A creates a Razorpay Payment Link.
 *
 * POST
 * /api/razorpay-payment-links
 *
 * Body:
 * {
 *   "amount": 10000,
 *   "description": "Payment for vehicle booking"
 * }
 */
const createTransporterPaymentLink = async (
  req,
  res,
  next
) => {
  try {
    const actorId =
      getTransporterActorId(req.user)

    if (!actorId) {
      return res.status(403).json({
        success: false,
        message:
          'Only transporter accounts can create payment links'
      })
    }

    const {
      amount,
      description,
      expireBy
    } = req.body || {}

    const finalAmount = Number(amount)

    if (
      !Number.isFinite(finalAmount) ||
      finalAmount <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Valid payment amount is required'
      })
    }

    const transporter =
      await Transporter.findById(actorId)

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message:
          'Transporter not found'
      })
    }

    const routeAccountId =
      transporter.razorpayRouteAccountId

    if (!routeAccountId) {
      return res.status(400).json({
        success: false,
        message:
          'Razorpay Route Linked Account is not configured for this transporter',
        reason:
          'RAZORPAY_ROUTE_ACCOUNT_NOT_CONFIGURED'
      })
    }

    const referenceId =
      makeReferenceId()

    const paymentLink =
      await createPaymentLinkWithTransfer({
        amount: finalAmount,

        currency: 'INR',

        referenceId,

        description:
          description ||
          `Porttivo payment to ${transporter.name || transporter.company || 'transporter'}`,

        customer:
          normalizeCustomer(transporter),

        routeAccountId,

        expireBy,

        notes: {
          transporterId: actorId,
          beneficiaryTransporterId:
            actorId
        },

        fetchImpl:
          req.fetch || global.fetch
      })

    const record =
      await RazorpayPaymentLink.create({
        publicId:
          `rpl_${crypto.randomBytes(8).toString('hex')}`,

        payerTransporterId:
          actorId,

        beneficiaryTransporterId:
          actorId,

        routeAccountId,

        razorpayPaymentLinkId:
          paymentLink.id,

        shortUrl:
          paymentLink.short_url || null,

        referenceId,

        amount:
          finalAmount,

        currency: 'INR',

        description:
          description || null,

        status:
          'CREATED',

        paymentResponse:
          paymentLink,

        metadata: {
          source: 'PORTTIVO',
          automaticTransfer: true
        }
      })

    logger.info(
      '[RAZORPAY_PAYMENT_LINK] Created',
      {
        paymentLinkId:
          record._id.toString(),

        razorpayPaymentLinkId:
          paymentLink.id,

        transporterId:
          actorId,

        routeAccountId,

        amount:
          finalAmount
      }
    )

    return res.status(201).json({
      success: true,

      message:
        'Razorpay payment link created successfully',

      data: {
        id:
          record._id,

        publicId:
          record.publicId,

        paymentLinkId:
          paymentLink.id,

        shortUrl:
          paymentLink.short_url,

        amount:
          finalAmount,

        currency:
          'INR',

        status:
          record.status,

        automaticTransfer:
          true,

        routeAccountId
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get payment link status.
 */
const getTransporterPaymentLinkStatus = async (
  req,
  res,
  next
) => {
  try {
    const actorId =
      getTransporterActorId(req.user)

    if (!actorId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      })
    }

    const record =
      await RazorpayPaymentLink.findOne({
        _id: req.params.id,
        payerTransporterId: actorId
      })

    if (!record) {
      return res.status(404).json({
        success: false,
        message:
          'Payment link not found'
      })
    }

    const remote =
      await fetchPaymentLink(
        record.razorpayPaymentLinkId,
        req.fetch || global.fetch
      )

    record.status =
      normalizePaymentLinkStatus(
        remote.status
      )

    record.paymentResponse =
      remote

    if (
      Array.isArray(remote.payments) &&
      remote.payments.length
    ) {
      const payment =
        remote.payments[0]

      record.razorpayPaymentId =
        payment.id || null

      record.paidAt =
        new Date(
          (payment.created_at || 0) * 1000
        )
    }

    await record.save()

    return res.status(200).json({
      success: true,

      data: {
        id:
          record.publicId,

        paymentLinkId:
          record.razorpayPaymentLinkId,

        shortUrl:
          record.shortUrl,

        amount:
          record.amount,

        currency:
          record.currency,

        status:
          record.status,

        razorpayPaymentId:
          record.razorpayPaymentId,

        transferStatus:
          record.transferStatus,

        transferredAmount:
          record.transferredAmount,

        razorpayTransferId:
          record.razorpayTransferId
      }
    })
  } catch (error) {
    next(error)
  }
}

const normalizePaymentLinkStatus = status => {
  const value =
    String(status || '')
      .trim()
      .toLowerCase()

  if (value === 'paid') {
    return 'PAID'
  }

  if (value === 'partially_paid') {
    return 'PARTIALLY_PAID'
  }

  if (value === 'expired') {
    return 'EXPIRED'
  }

  if (value === 'cancelled') {
    return 'CANCELLED'
  }

  return 'CREATED'
}

/**
 * Cancel Payment Link.
 */
const cancelTransporterPaymentLink = async (
  req,
  res,
  next
) => {
  try {
    const actorId =
      getTransporterActorId(req.user)

    if (!actorId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      })
    }

    const record =
      await RazorpayPaymentLink.findOne({
        _id: req.params.id,
        payerTransporterId: actorId
      })

    if (!record) {
      return res.status(404).json({
        success: false,
        message:
          'Payment link not found'
      })
    }

    const response =
      await cancelPaymentLink(
        record.razorpayPaymentLinkId,
        req.fetch || global.fetch
      )

    record.status =
      'CANCELLED'

    record.paymentResponse =
      response

    await record.save()

    return res.status(200).json({
      success: true,

      message:
        'Payment link cancelled successfully'
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Razorpay Payment Link webhook.
 */
const handleRazorpayPaymentLinkWebhook =
  async (
    req,
    res,
    next
  ) => {
    try {
      const rawBody =
        req.rawBody ||
        JSON.stringify(req.body || {})

      const signature =
        req.headers[
          'x-razorpay-signature'
        ]

      if (
        !signature ||
        !process.env.RAZORPAY_WEBHOOK_SECRET
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Webhook signature is missing'
        })
      }

      const expectedSignature =
        crypto
          .createHmac(
            'sha256',
            process.env.RAZORPAY_WEBHOOK_SECRET
          )
          .update(rawBody)
          .digest('hex')

      const valid =
        crypto.timingSafeEqual(
          Buffer.from(signature),
          Buffer.from(expectedSignature)
        )

      if (!valid) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid Razorpay webhook signature'
        })
      }

      const event =
        req.body?.event

      const paymentEntity =
        req.body?.payload?.payment?.entity ||
        {}

      const transferEntity =
        req.body?.payload?.transfer?.entity ||
        {}

      const paymentLinkId =
        paymentEntity?.notes?.paymentLinkId ||
        paymentEntity?.notes?.payment_link_id ||
        null

      let record = null

      if (paymentLinkId) {
        record =
          await RazorpayPaymentLink.findOne({
            razorpayPaymentLinkId:
              paymentLinkId
          })
      }

      if (!record && paymentEntity?.id) {
        record =
          await RazorpayPaymentLink.findOne({
            razorpayPaymentId:
              paymentEntity.id
          })
      }

      if (
        !record &&
        transferEntity?.id
      ) {
        record =
          await RazorpayPaymentLink.findOne({
            razorpayTransferId:
              transferEntity.id
          })
      }

      if (!record) {
        logger.warn(
          '[RAZORPAY_PAYMENT_LINK] Unknown webhook',
          {
            event
          }
        )

        return res.status(200).json({
          success: true
        })
      }

      record.webhookPayload =
        req.body

      if (
        event ===
          'payment_link.paid' ||
        event ===
          'payment.captured'
      ) {
        record.status =
          'PAID'

        record.razorpayPaymentId =
          paymentEntity.id ||
          record.razorpayPaymentId

        record.paidAt =
          new Date()

        record.transferStatus =
          'PENDING'
      }

      if (
        event ===
        'transfer.processed'
      ) {
        record.transferStatus =
          'PROCESSED'

        record.razorpayTransferId =
          transferEntity.id ||
          record.razorpayTransferId

        record.transferredAmount =
          Number(
            transferEntity.amount || 0
          ) / 100

        record.transferredAt =
          new Date()
      }

      if (
        event ===
        'transfer.failed'
      ) {
        record.transferStatus =
          'FAILED'

        record.razorpayTransferId =
          transferEntity.id ||
          record.razorpayTransferId
      }

      if (
        event ===
        'transfer.reversed'
      ) {
        record.transferStatus =
          'REVERSED'
      }

      await record.save()

      return res.status(200).json({
        success: true,
        message:
          'Webhook processed successfully'
      })
    } catch (error) {
      next(error)
    }
  }

module.exports = {
  createTransporterPaymentLink,
  getTransporterPaymentLinkStatus,
  cancelTransporterPaymentLink,
  handleRazorpayPaymentLinkWebhook
}