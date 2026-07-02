const mongoose = require('mongoose')
const PaymentSession = require('../models/PaymentSession')
const {
  buildPaymentInitiationRequest,
  getAvailableGatewayOptions,
  getGatewayPayloadMetadata,
  getProviderConfig,
  makeTransactionId,
  normalizeMoney,
  normalizeProvider,
  resolvePayerProfile,
  verifyGatewayWebhook
} = require('../services/paymentGateway.service')

const toObjectIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString ? value.toString() : String(value)
}

const serializePaymentSession = (payment) => {
  if (!payment) {
    return null
  }

  return {
    id: payment._id ? payment._id.toString() : null,
    referenceType: payment.referenceType,
    referenceId: payment.referenceId,
    purpose: payment.purpose,
    provider: payment.provider,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    merchantTransactionId: payment.merchantTransactionId,
    providerTransactionId: payment.providerTransactionId || null,
    providerOrderId: payment.providerOrderId || null,
    paymentGatewayUrl: payment.paymentGatewayUrl || null,
    paymentRequest: payment.paymentRequest || {},
    paymentResponse: payment.paymentResponse || {},
    failureReason: payment.failureReason || null,
    payer: payment.payer || {},
    metadata: payment.metadata || {},
    initiatedAt: payment.initiatedAt || null,
    completedAt: payment.completedAt || null,
    failedAt: payment.failedAt || null,
    createdAt: payment.createdAt || null,
    updatedAt: payment.updatedAt || null
  }
}

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const assertPaymentAccess = (payment, user) => {
  if (!payment || user?.userType === 'admin') {
    return true
  }

  const actorId = toObjectIdString(user?.id)
  const payerId = toObjectIdString(payment.payer?.userId)
  const initiatedById = toObjectIdString(payment.initiatedBy?.userId)

  return Boolean(actorId && (actorId === payerId || actorId === initiatedById))
}

const getPaymentGatewayOptions = async (req, res, next) => {
  try {
    return res.status(200).json({
      success: true,
      data: {
        defaultCurrency: 'INR',
        gateways: getAvailableGatewayOptions()
      }
    })
  } catch (error) {
    next(error)
  }
}

const findLatestPaymentSession = async ({ referenceType, referenceId, provider }) => {
  return PaymentSession.findOne({
    referenceType,
    referenceId,
    provider
  }).sort({ createdAt: -1 })
}

const initiatePaymentSession = async (req, res, next) => {
  try {
    const body = req.body || {}
    const provider = normalizeProvider(body.provider)
    const referenceType = String(body.referenceType || '').trim()
    const referenceId = String(body.referenceId || '').trim()
    const purpose = String(body.purpose || '').trim()
    const currency = String(body.currency || 'INR').trim().toUpperCase()
    const amount = normalizeMoney(body.amount)
    const payer = resolvePayerProfile(body.payer || {}, req.user)
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
    const successUrl = body.successUrl || null
    const failureUrl = body.failureUrl || null

    if (!provider) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported payment provider'
      })
    }

    const gatewayConfig = getProviderConfig(provider)
    if (!gatewayConfig?.configured) {
      return res.status(500).json({
        success: false,
        message: `${gatewayConfig?.displayName || provider} is not configured`
      })
    }

    if (!referenceType) {
      return res.status(400).json({
        success: false,
        message: 'referenceType is required'
      })
    }

    if (!referenceId) {
      return res.status(400).json({
        success: false,
        message: 'referenceId is required'
      })
    }

    if (!purpose) {
      return res.status(400).json({
        success: false,
        message: 'purpose is required'
      })
    }

    if (provider === 'PAYU' && !payer.email) {
      return res.status(400).json({
        success: false,
        message: 'Payer email is required for PayU payments'
      })
    }

    if (provider === 'CASHFREE' && (!payer.email || !payer.mobile)) {
      return res.status(400).json({
        success: false,
        message: 'Payer email and mobile are required for Cashfree payments'
      })
    }

    const existingPayment = await findLatestPaymentSession({
      referenceType,
      referenceId,
      provider
    })

    if (existingPayment?.status === 'SUCCESS') {
      return res.status(200).json({
        success: true,
        message: 'Payment has already been completed for this reference',
        data: {
          payment: serializePaymentSession(existingPayment),
          gateway: {
            provider,
            name: gatewayConfig.displayName,
            mode: gatewayConfig.mode
          }
        }
      })
    }

    if (existingPayment?.status === 'PENDING' || existingPayment?.status === 'CREATED') {
      const hasReusableRequest =
        existingPayment.paymentRequest?.fields ||
        existingPayment.paymentRequest?.rawResponse ||
        existingPayment.paymentGatewayUrl

      if (hasReusableRequest) {
        return res.status(200).json({
          success: true,
          message: 'A payment request already exists for this reference',
          data: {
            payment: serializePaymentSession(existingPayment),
            gateway: {
              provider,
              name: gatewayConfig.displayName,
              mode: gatewayConfig.mode
            }
          }
        })
      }
    }

    const session = await mongoose.startSession()
    session.startTransaction()

    try {
      const merchantTransactionId = makeTransactionId(provider === 'PAYU' ? 'PAYU' : 'CF')
      const [payment] = await PaymentSession.create(
        [
          {
            referenceType,
            referenceId,
            purpose,
            provider,
            status: 'CREATED',
            amount: Number(amount),
            currency: currency || 'INR',
            merchantTransactionId,
            payer: {
              userId: payer.userId ? payer.userId : null,
              userType: payer.userType || null,
              name: payer.name || null,
              email: payer.email || null,
              mobile: payer.mobile || null
            },
            metadata,
            initiatedBy: {
              userId: req.user?.id || null,
              userType: req.user?.userType || null
            },
            initiatedAt: new Date()
          }
        ],
        { session }
      )

      const paymentRequest = await buildPaymentInitiationRequest({
        provider,
        merchantTransactionId,
        amount,
        payer,
        reference: {
          referenceType,
          referenceId,
          purpose
        },
        paymentSessionId: payment._id,
        successUrl,
        failureUrl,
        metadata
      })

      payment.paymentGatewayUrl = paymentRequest.actionUrl
      payment.paymentRequest = paymentRequest
      payment.status = 'PENDING'
      await payment.save({ session })

      await session.commitTransaction()
      session.endSession()

      return res.status(200).json({
        success: true,
        message: `${gatewayConfig.displayName} payment request created successfully`,
        data: {
          payment: serializePaymentSession(payment),
          gateway: {
            provider,
            name: gatewayConfig.displayName,
            mode: gatewayConfig.mode
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

const getPaymentSessionStatus = async (req, res, next) => {
  try {
    const { id } = req.params
    const payment = await PaymentSession.findById(id)

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment session not found'
      })
    }

    if (!assertPaymentAccess(payment, req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      })
    }

    const gateway = getProviderConfig(payment.provider)

    return res.status(200).json({
      success: true,
      data: {
        payment: serializePaymentSession(payment),
        gateway: gateway
          ? {
              provider: gateway.provider,
              name: gateway.displayName,
              mode: gateway.mode,
              configured: gateway.configured
            }
          : null,
        availableGateways: getAvailableGatewayOptions()
      }
    })
  } catch (error) {
    next(error)
  }
}

const getPaymentSessionByReference = async (req, res, next) => {
  try {
    const referenceType = String(req.params.referenceType || '').trim()
    const referenceId = String(req.params.referenceId || '').trim()
    const provider = normalizeProvider(req.query.provider || req.body?.provider || '')

    if (!referenceType || !referenceId) {
      return res.status(400).json({
        success: false,
        message: 'referenceType and referenceId are required'
      })
    }

    const query = {
      referenceType,
      referenceId
    }

    if (provider) {
      query.provider = provider
    }

    const payment = await PaymentSession.findOne(query).sort({ createdAt: -1 })
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment session not found'
      })
    }

    if (!assertPaymentAccess(payment, req.user)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      })
    }

    return res.status(200).json({
      success: true,
      data: {
        payment: serializePaymentSession(payment),
        availableGateways: getAvailableGatewayOptions()
      }
    })
  } catch (error) {
    next(error)
  }
}

const handleGatewayWebhook = async (req, res, next) => {
  try {
    const provider = normalizeProvider(req.params.provider)
    if (!provider) {
      return res.status(400).json({
        success: false,
        message: 'Unsupported payment provider'
      })
    }

    const body = {
      ...(req.query || {}),
      ...(req.body || {})
    }

    const merchantTransactionId =
      String(
        body.txnid ||
          body.order_id ||
          body.orderId ||
          body.merchantTransactionId ||
          body.cf_order_id ||
          ''
      ).trim()

    const paymentSessionId = String(body.udf1 || body.payment_session_id || '').trim()

    let payment = null
    if (paymentSessionId && mongoose.Types.ObjectId.isValid(paymentSessionId)) {
      payment = await PaymentSession.findById(paymentSessionId)
    }

    if (!payment && merchantTransactionId) {
      payment = await PaymentSession.findOne({
        merchantTransactionId,
        provider
      })
    }

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment session not found'
      })
    }

    const verified = verifyGatewayWebhook({
      provider,
      body,
      headers: req.headers,
      rawBody: req.rawBody || ''
    })

    if (!verified) {
      payment.status = 'FAILED'
      payment.failureReason = `Invalid ${provider} webhook signature`
      payment.paymentResponse = { ...body, verified: false }
      payment.failedAt = new Date()
      await payment.save()

      return res.status(400).json({
        success: false,
        message: payment.failureReason
      })
    }

    const metadata = getGatewayPayloadMetadata(provider, body)
    const responseStatus = metadata.status
    payment.paymentResponse = { ...body, verified: true }
    payment.callbackPayload = body
    payment.providerTransactionId =
      metadata.providerTransactionId || payment.providerTransactionId
    payment.providerOrderId = metadata.providerOrderId || payment.providerOrderId

    if (responseStatus === 'SUCCESS') {
      payment.status = 'SUCCESS'
      payment.completedAt = new Date()
      payment.failedAt = null
      payment.failureReason = null
    } else if (responseStatus === 'FAILED') {
      payment.status = 'FAILED'
      payment.failedAt = new Date()
      payment.failureReason =
        body.error_Message || body.error || body.failure_reason || 'Payment failed'
    } else if (responseStatus === 'CANCELLED') {
      payment.status = 'CANCELLED'
      payment.failedAt = new Date()
      payment.failureReason =
        body.error_Message || body.error || body.failure_reason || 'Payment cancelled'
    } else if (responseStatus === 'REFUNDED') {
      payment.status = 'REFUNDED'
      payment.completedAt = payment.completedAt || new Date()
      payment.failureReason = null
    } else {
      payment.status = 'PENDING'
    }

    await payment.save()

    return res.status(200).json({
      success: true,
      message: `${provider} webhook processed successfully`
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getPaymentGatewayOptions,
  initiatePaymentSession,
  getPaymentSessionStatus,
  getPaymentSessionByReference,
  handleGatewayWebhook,
  serializePaymentSession
}
