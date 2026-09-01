const mongoose = require('mongoose')
const crypto = require('crypto')

const Transporter = require('../models/Transporter')
const PaymentSession = require('../models/PaymentSession')
const RazorpayPaymentLink = require('../models/RazorpayPaymentLink')
const {
  createAutomaticPayoutForPayment
} = require('../services/razorpayPayout.service')

const {
  createPaymentLinkWithTransfer,
  fetchPaymentLink,
  cancelPaymentLink,
  makeReferenceId,
  createPaymentLink
} = require('../services/razorpayRoute.service')

const { getTransporterActorId } = require('../utils/transporterActor')

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
  name: transporter?.name || transporter?.company || 'Porttivo Transporter',

  email:
    String(transporter?.email || '')
      .trim()
      .toLowerCase() || undefined,

  contact: transporter?.mobile || undefined
})

const normalizeMaybeString = value => {
  const normalized = String(value || '').trim()

  return normalized || null
}

const buildRazorpayPaymentLinkPayoutMetadata = ({
  payeeId,
  payeeType = 'TRANSPORTER',
  referenceType = null,
  referenceId = null,
  paymentSessionId = null,
  paymentLinkReferenceId = null,
  transferMode = 'IMPS'
} = {}) => ({
  payeeId,
  payeeType,
  referenceType,
  referenceId,
  paymentSessionId,
  paymentLinkReferenceId,
  transferMode
})

const extractLinkedPaymentSessionId = ({
  record = null,
  paymentEntity = null,
  mergedPayload = null
} = {}) => {
  const notes =
    paymentEntity?.notes && typeof paymentEntity.notes === 'object'
      ? paymentEntity.notes
      : {}

  return normalizeMaybeString(
    record?.paymentSessionId ||
      record?.metadata?.paymentSessionId ||
      record?.metadata?.payout?.paymentSessionId ||
      notes.paymentSessionId ||
      notes.payment_session_id ||
      mergedPayload?.paymentSessionId ||
      mergedPayload?.payment_session_id
  )
}

const getWebhookSignature = req =>
  req.headers?.['x-razorpay-signature'] ||
  req.body?.razorpay_signature ||
  req.body?.signature ||
  req.query?.razorpay_signature ||
  req.query?.signature ||
  null

const areSignaturesEqual = (provided, expected) => {
  const providedBuffer = Buffer.from(String(provided || ''))
  const expectedBuffer = Buffer.from(String(expected || ''))

  if (providedBuffer.length !== expectedBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
}

const applyRemotePaymentLinkState = (record, remote) => {
  if (!record || !remote) {
    return record
  }

  record.status = normalizePaymentLinkStatus(remote.status)

  record.paymentResponse = remote

  if (Array.isArray(remote.payments) && remote.payments.length) {
    const payment = remote.payments[0]

    record.razorpayPaymentId = payment.id || null

    record.paidAt = new Date((payment.created_at || 0) * 1000)
  }

  return record
}

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
const createTransporterPaymentLink = async (req, res, next) => {
  try {
    const actorId = getTransporterActorId(req.user)

    if (!actorId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can create payment links'
      })
    }

    const {
      amount,
      description,
      expireBy,
      callbackUrl,
      payerTransporterId,
      referenceType,
      referenceId
    } = req.body || {}

    const finalAmount = Number(amount)

    if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid payment amount is required'
      })
    }

    const transporter = await Transporter.findById(actorId)

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found'
      })
    }

    // const routeAccountId =
    //   transporter.razorpayRouteAccountId

    // if (!routeAccountId) {
    //   return res.status(400).json({
    //     success: false,
    //     message:
    //       'Razorpay Route Linked Account is not configured for this transporter',
    //     reason:
    //       'RAZORPAY_ROUTE_ACCOUNT_NOT_CONFIGURED'
    //   })
    // }

    const payerId = normalizeMaybeString(safeId(payerTransporterId)) || actorId

    const payerTransporter =
      payerId === actorId ? transporter : await Transporter.findById(payerId)

    if (!payerTransporter) {
      return res.status(404).json({
        success: false,
        message: 'Payer transporter not found'
      })
    }

    const businessReferenceType = normalizeMaybeString(referenceType)
    const businessReferenceId = normalizeMaybeString(referenceId)
    const paymentReferenceId = makeReferenceId()
    const normalizedCallbackUrl = normalizeMaybeString(callbackUrl)
    const payoutMetadata = buildRazorpayPaymentLinkPayoutMetadata({
      payeeId: actorId,
      referenceType: businessReferenceType,
      referenceId: businessReferenceId,
      paymentLinkReferenceId: paymentReferenceId,
      transferMode: 'IMPS'
    })

    const paymentSession = await PaymentSession.create({
      publicId: `pay_${crypto.randomBytes(8).toString('hex')}`,
      referenceType: businessReferenceType || 'RAZORPAY_PAYMENT_LINK',
      referenceId: businessReferenceId || paymentReferenceId,
      purpose:
        description ||
        `Porttivo payment link for ${
          transporter.name || transporter.company || 'transporter'
        }`,
      provider: 'RAZORPAY',
      status: 'CREATED',
      amount: finalAmount,
      currency: 'INR',
      merchantTransactionId: paymentReferenceId,
      payer: {
        userId: payerTransporter?._id || null,
        userType: 'TRANSPORTER',
        name: payerTransporter?.name || null,
        email: payerTransporter?.email || null,
        mobile: payerTransporter?.mobile || null
      },
      metadata: {
        source: 'RAZORPAY_PAYMENT_LINK',
        paymentLinkReferenceId: paymentReferenceId,
        payout: {
          ...payoutMetadata,
          payeeId: actorId,
          paymentSessionId: null
        }
      },
      initiatedBy: {
        userId: req.user?.id || null,
        userType: req.user?.userType || null
      },
      initiatedAt: new Date()
    })

    let paymentLink

    try {
      paymentLink = await createPaymentLink({
        amount: finalAmount,
        currency: 'INR',
        referenceId: paymentReferenceId,

        description:
          description ||
          `Porttivo payment to ${
            transporter.name || transporter.company || 'transporter'
          }`,

        customer: normalizeCustomer(payerTransporter),

        expireBy,

        callbackUrl: normalizedCallbackUrl || undefined,

        notes: {
          transporterId: actorId,
          payerTransporterId: payerId,
          beneficiaryTransporterId: actorId,
          paymentSessionId: paymentSession._id.toString(),
          paymentSessionPublicId: paymentSession.publicId,
          payout: {
            ...payoutMetadata,
            payeeId: actorId,
            paymentSessionId: paymentSession._id.toString()
          },

          referenceType: businessReferenceType || undefined,

          referenceId: businessReferenceId || undefined
        },

        fetchImpl: req.fetch || global.fetch
      })
    } catch (error) {
      await PaymentSession.deleteOne({ _id: paymentSession._id })
      throw error
    }

    const record = await RazorpayPaymentLink.create({
      publicId: `rpl_${crypto.randomBytes(8).toString('hex')}`,

      payerTransporterId: payerId,

      beneficiaryTransporterId: actorId,

      paymentSessionId: paymentSession._id,

      razorpayPaymentLinkId: paymentLink.id,

      shortUrl: paymentLink.short_url || null,

      referenceId: paymentReferenceId,

      businessReferenceType,

      businessReferenceId,

      callbackUrl: normalizedCallbackUrl || null,

      amount: finalAmount,

      currency: 'INR',

      description: description || null,

      status: 'CREATED',

      paymentResponse: paymentLink,

      metadata: {
        source: 'PORTTIVO',
        automaticTransfer: false,
        paymentSessionId: paymentSession._id.toString(),
        payerTransporterId: payerId,
        beneficiaryTransporterId: actorId,
        businessReferenceType,
        businessReferenceId,
        callbackUrl: normalizedCallbackUrl || null,
        payout: {
          ...payoutMetadata,
          payeeId: actorId,
          paymentSessionId: paymentSession._id.toString(),
          paymentLinkId: paymentLink.id
        }
      }
    })

    paymentSession.paymentGatewayUrl = paymentLink.short_url || null
    paymentSession.paymentRequest = {
      provider: 'RAZORPAY',
      actionUrl: paymentLink.short_url || null,
      method: 'GET',
      fields: {
        payment_link_id: paymentLink.id,
        reference_id: paymentReferenceId
      },
      rawResponse: paymentLink
    }
    paymentSession.paymentResponse = paymentLink
    paymentSession.metadata = {
      ...(paymentSession.metadata || {}),
      paymentLink: {
        paymentLinkId: paymentLink.id,
        shortUrl: paymentLink.short_url || null,
        recordId: record._id?.toString() || null
      },
      payout: {
        ...(paymentSession.metadata?.payout || {}),
        ...payoutMetadata,
        payeeId: actorId,
        paymentSessionId: paymentSession._id.toString(),
        paymentLinkId: paymentLink.id
      }
    }
    await paymentSession.save()

    logger.info('[RAZORPAY_PAYMENT_LINK] Created', {
      paymentLinkId: record._id.toString(),

      razorpayPaymentLinkId: paymentLink.id,

      payerTransporterId: payerId,

      beneficiaryTransporterId: actorId,

      amount: finalAmount
    })

    return res.status(201).json({
      success: true,
      message: 'Razorpay payment link created successfully',
      data: {
        id: record._id,
        publicId: record.publicId,
        paymentLinkId: paymentLink.id,
        shortUrl: paymentLink.short_url,
        paymentSessionId: paymentSession._id,
        amount: finalAmount,
        currency: 'INR',
        status: record.status,
        automaticTransfer: false,
        // routeAccountId,
        payerTransporterId: payerId,
        beneficiaryTransporterId: actorId,
        businessReferenceType,
        businessReferenceId,
        callbackUrl: normalizedCallbackUrl || null
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Get payment link status.
 */
const getTransporterPaymentLinkStatus = async (req, res, next) => {
  try {
    const actorId = getTransporterActorId(req.user)

    if (!actorId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      })
    }

    const record = await RazorpayPaymentLink.findOne({
      _id: req.params.id,
      payerTransporterId: actorId
    })

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Payment link not found'
      })
    }

    const remote = await fetchPaymentLink(
      record.razorpayPaymentLinkId,
      req.fetch || global.fetch
    )

    applyRemotePaymentLinkState(record, remote)

    await record.save()

    return res.status(200).json({
      success: true,

      data: {
        id: record.publicId,

        paymentLinkId: record.razorpayPaymentLinkId,

        shortUrl: record.shortUrl,

        amount: record.amount,

        currency: record.currency,

        status: record.status,

        razorpayPaymentId: record.razorpayPaymentId,

        transferStatus: record.transferStatus,

        transferredAmount: record.transferredAmount,

        razorpayTransferId: record.razorpayTransferId
      }
    })
  } catch (error) {
    next(error)
  }
}

const normalizePaymentLinkStatus = status => {
  const value = String(status || '')
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
const cancelTransporterPaymentLink = async (req, res, next) => {
  try {
    const actorId = getTransporterActorId(req.user)

    if (!actorId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      })
    }

    const record = await RazorpayPaymentLink.findOne({
      _id: req.params.id,
      payerTransporterId: actorId
    })

    if (!record) {
      return res.status(404).json({
        success: false,
        message: 'Payment link not found'
      })
    }

    const response = await cancelPaymentLink(
      record.razorpayPaymentLinkId,
      req.fetch || global.fetch
    )

    record.status = 'CANCELLED'

    record.paymentResponse = response

    await record.save()

    return res.status(200).json({
      success: true,

      message: 'Payment link cancelled successfully'
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Razorpay Payment Link webhook.
 */
const handleRazorpayPaymentLinkWebhook = async (req, res, next) => {
  try {
    const mergedPayload = {
      ...(req.query || {}),
      ...(req.body || {})
    }

    const signature = getWebhookSignature(req)

    const event =
      req.body?.event || req.query?.event || mergedPayload.event || null

    const paymentEntity =
      req.body?.payload?.payment?.entity ||
      req.body?.payload?.payment_link?.entity ||
      req.query?.payload?.payment?.entity ||
      req.query?.payload?.payment_link?.entity ||
      {}

    const transferEntity =
      req.body?.payload?.transfer?.entity ||
      req.query?.payload?.transfer?.entity ||
      {}

    const paymentLinkId =
      paymentEntity?.notes?.paymentLinkId ||
      paymentEntity?.notes?.payment_link_id ||
      paymentEntity?.paymentLinkId ||
      paymentEntity?.payment_link_id ||
      mergedPayload?.paymentLinkId ||
      mergedPayload?.payment_link_id ||
      mergedPayload?.razorpay_payment_link_id ||
      null

    const expectedSignature =
      signature && process.env.RAZORPAY_WEBHOOK_SECRET
        ? crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
            .update(req.rawBody || JSON.stringify(mergedPayload || {}))
            .digest('hex')
        : null

    const signatureValid =
      Boolean(signature) &&
      Boolean(expectedSignature) &&
      areSignaturesEqual(
        String(signature).trim().toLowerCase(),
        String(expectedSignature).trim().toLowerCase()
      )

    if (signature && !signatureValid && req.method !== 'GET') {
      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay webhook signature'
      })
    }

    let record = null
    let paymentSession = null

    if (paymentLinkId) {
      record = await RazorpayPaymentLink.findOne({
        razorpayPaymentLinkId: paymentLinkId
      })
    }

    if (!record && paymentEntity?.id) {
      record = await RazorpayPaymentLink.findOne({
        razorpayPaymentId: paymentEntity.id
      })
    }

    if (!record && transferEntity?.id) {
      record = await RazorpayPaymentLink.findOne({
        razorpayTransferId: transferEntity.id
      })
    }

    const linkedPaymentSessionId = extractLinkedPaymentSessionId({
      record,
      paymentEntity,
      mergedPayload
    })

    if (
      linkedPaymentSessionId &&
      mongoose.Types.ObjectId.isValid(linkedPaymentSessionId)
    ) {
      paymentSession = await PaymentSession.findById(linkedPaymentSessionId)
    }

    if (!paymentSession && record?.paymentSessionId) {
      const recordPaymentSessionId = normalizeMaybeString(record.paymentSessionId)
      if (
        recordPaymentSessionId &&
        mongoose.Types.ObjectId.isValid(recordPaymentSessionId)
      ) {
        paymentSession = await PaymentSession.findById(recordPaymentSessionId)
      }
    }

    if (paymentLinkId && req.method === 'GET') {
      const remote = await fetchPaymentLink(
        paymentLinkId,
        req.fetch || global.fetch
      )

      record = await RazorpayPaymentLink.findOne({
        razorpayPaymentLinkId: remote.id || paymentLinkId
      })

      if (record) {
        applyRemotePaymentLinkState(record, remote)

        record.webhookPayload = {
          method: req.method,
          query: req.query || {},
          body: req.body || {},
          signaturePresent: Boolean(signature),
          signatureValid,
          verificationSource: 'provider_lookup'
        }

        await record.save()
      }
    }

    if (!record && !paymentSession) {
      logger.warn('[RAZORPAY_PAYMENT_LINK] Unknown webhook', {
        event,
        paymentLinkId
      })

      return res.status(200).json({
        success: true
      })
    }

    const isPaidEvent =
      event === 'payment_link.paid' || event === 'payment.captured'

    if (record) {
      record.webhookPayload = {
        method: req.method,
        query: req.query || {},
        body: req.body || {},
        signaturePresent: Boolean(signature),
        signatureValid
      }

      if (isPaidEvent) {
        record.status = 'PAID'
        record.razorpayPaymentId = paymentEntity.id || record.razorpayPaymentId
        record.paidAt = new Date()
        record.transferStatus = 'PENDING'
      }

      if (event === 'transfer.processed') {
        record.transferStatus = 'PROCESSED'
        record.razorpayTransferId = transferEntity.id || record.razorpayTransferId
        record.transferredAmount = Number(transferEntity.amount || 0) / 100
        record.transferredAt = new Date()
      }

      if (event === 'transfer.failed') {
        record.transferStatus = 'FAILED'
        record.razorpayTransferId = transferEntity.id || record.razorpayTransferId
      }

      if (event === 'transfer.reversed') {
        record.transferStatus = 'REVERSED'
      }

      await record.save()
    }

    let payout = null

    if (paymentSession) {
      const previousPaymentStatus = paymentSession.status

      paymentSession.paymentResponse = {
        ...(paymentSession.paymentResponse || {}),
        ...mergedPayload,
        verified: true
      }
      paymentSession.callbackPayload = mergedPayload
      paymentSession.providerTransactionId =
        paymentEntity.id || paymentSession.providerTransactionId
      paymentSession.providerOrderId =
        paymentLinkId ||
        paymentSession.providerOrderId ||
        paymentSession.metadata?.payout?.paymentLinkId ||
        null

      if (isPaidEvent) {
        paymentSession.status = 'SUCCESS'
        paymentSession.completedAt = new Date()
        paymentSession.failedAt = null
        paymentSession.failureReason = null
      }

      await paymentSession.save()

      if (isPaidEvent) {
        const payoutAlreadyLinked = Boolean(
          paymentSession.metadata?.payout?.id ||
            record?.metadata?.payout?.id
        )

        if (previousPaymentStatus !== 'SUCCESS' || !payoutAlreadyLinked) {
          payout = await createAutomaticPayoutForPayment(paymentSession, {
            fetchImpl: req.fetch || global.fetch
          })
        } else {
          payout = null
        }
      }
    }

    if (payout) {
      const payoutTransferId =
        payout.provider === 'RAZORPAY'
          ? payout.razorpay?.payoutId || null
          : payout.cashfree?.transferId || null
      const payoutReferenceId =
        payout.provider === 'RAZORPAY'
          ? payout.razorpay?.referenceId || null
          : payout.cashfree?.referenceId || null

      if (paymentSession) {
        paymentSession.metadata = {
          ...(paymentSession.metadata || {}),
          payout: {
            ...(paymentSession.metadata?.payout || {}),
            id: payout._id?.toString() || null,
            provider: payout.provider || paymentSession.provider || null,
            status: payout.status,
            transferId: payoutTransferId,
            referenceId: payoutReferenceId
          }
        }
        await paymentSession.save()
      }

      if (record) {
        record.metadata = {
          ...(record.metadata || {}),
          payout: {
            ...(record.metadata?.payout || {}),
            id: payout._id?.toString() || null,
            provider: payout.provider || record.metadata?.payout?.provider || null,
            status: payout.status,
            transferId: payoutTransferId,
            referenceId: payoutReferenceId
          }
        }
        await record.save()
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook processed successfully'
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
