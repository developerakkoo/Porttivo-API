const mongoose = require('mongoose')
const Payout = require('../models/Payout')
const PaymentSession = require('../models/PaymentSession')
const {
  buildPayoutStatusMessage,
  createAutomaticPayoutForPayment,
  createPayoutRecord,
  findPayeeRecordByBeneficiaryId,
  findPayeeRecordById,
  getPayoutById,
  getPayoutSummary,
  getPayeeSnapshot,
  getRegisteredBeneficiary,
  handleCashfreePayoutWebhook,
  processDuePayoutRetries,
  registerBeneficiary,
  removeRegisteredBeneficiary,
  serializePayout,
  startPayoutTransfer,
  normalizeMoney
} = require('../services/cashfreePayout.service')

const safeObjectIdString = (value) => {
  if (!value) return null
  if (typeof value === 'string') return value
  if (value._id) return value._id.toString()
  return value.toString ? value.toString() : String(value)
}

const assertPayoutAccess = (payout, user) => {
  if (!payout || user?.userType === 'admin') {
    return true
  }

  const actorId = safeObjectIdString(user?.id)
  const payerId = safeObjectIdString(payout.payerId)
  const payeeId = safeObjectIdString(payout.payeeId)

  return Boolean(actorId && (actorId === payerId || actorId === payeeId))
}

const parseBeneficiaryRequest = (source = {}) => ({
  payeeId: safeObjectIdString(
    source.payeeId || source.payee_id || source.payee || null
  ),
  beneficiaryId: String(
    source.beneficiaryId ||
      source.beneficiary_id ||
      source.beneId ||
      source.bene_id ||
      ''
  ).trim(),
  bankAccountNumber: String(
    source.bankAccountNumber ||
      source.bank_account_number ||
      source.bankAccount ||
      ''
  ).trim(),
  bankIfsc: String(source.bankIfsc || source.bank_ifsc || source.ifsc || '').trim().toUpperCase()
})

const hasBeneficiaryAccess = (req, payee) => {
  if (req.user?.userType === 'admin') {
    return true
  }

  return safeObjectIdString(req.user?.id) === safeObjectIdString(payee?._id)
}

const normalizeBeneficiaryPayload = (beneficiary = {}) => {
  const instrumentDetails =
    beneficiary.beneficiaryInstrumentDetails ||
    beneficiary.beneficiary_instrument_details ||
    {}
  const contactDetails =
    beneficiary.beneficiaryContactDetails ||
    beneficiary.beneficiary_contact_details ||
    {}

  return {
    beneficiaryId:
      beneficiary.beneficiaryId ||
      beneficiary.beneficiary_id ||
      beneficiary.beneId ||
      beneficiary.bene_id ||
      null,
    beneficiaryName:
      beneficiary.beneficiaryName ||
      beneficiary.beneficiary_name ||
      beneficiary.name ||
      null,
    beneficiaryInstrumentDetails: {
      bankAccountNumber:
        instrumentDetails.bankAccountNumber ||
        instrumentDetails.bank_account_number ||
        null,
      bankIfsc:
        instrumentDetails.bankIfsc ||
        instrumentDetails.bank_ifsc ||
        null,
      vpa: instrumentDetails.vpa || null
    },
    beneficiaryContactDetails: {
      beneficiaryEmail:
        contactDetails.beneficiaryEmail ||
        contactDetails.beneficiary_email ||
        null,
      beneficiaryPhone:
        contactDetails.beneficiaryPhone ||
        contactDetails.beneficiary_phone ||
        null,
      beneficiaryCountryCode:
        contactDetails.beneficiaryCountryCode ||
        contactDetails.beneficiary_country_code ||
        null,
      beneficiaryAddress:
        contactDetails.beneficiaryAddress ||
        contactDetails.beneficiary_address ||
        null,
      beneficiaryCity:
        contactDetails.beneficiaryCity || contactDetails.beneficiary_city || null,
      beneficiaryState:
        contactDetails.beneficiaryState ||
        contactDetails.beneficiary_state ||
        null,
      beneficiaryPostalCode:
        contactDetails.beneficiaryPostalCode ||
        contactDetails.beneficiary_postal_code ||
        null
    },
    beneficiaryStatus:
      beneficiary.beneficiaryStatus ||
      beneficiary.beneficiary_status ||
      beneficiary.status ||
      null,
    addedOn: beneficiary.addedOn || beneficiary.added_on || null,
    providerResponse: beneficiary
  }
}

const normalizeBeneficiaryForFrontend = (beneficiary = {}) => {
  const instrumentDetails =
    beneficiary.beneficiaryInstrumentDetails ||
    beneficiary.beneficiary_instrument_details ||
    {}
  const contactDetails =
    beneficiary.beneficiaryContactDetails ||
    beneficiary.beneficiary_contact_details ||
    {}

  return {
    beneficiaryId:
      beneficiary.beneficiaryId ||
      beneficiary.beneficiary_id ||
      beneficiary.beneId ||
      beneficiary.bene_id ||
      null,
    beneficiaryName:
      beneficiary.beneficiaryName ||
      beneficiary.beneficiary_name ||
      beneficiary.name ||
      null,
    status:
      beneficiary.beneficiaryStatus ||
      beneficiary.beneficiary_status ||
      beneficiary.status ||
      null,
    accountNumber:
      instrumentDetails.bankAccountNumber ||
      instrumentDetails.bank_account_number ||
      null,
    ifsc: instrumentDetails.bankIfsc || instrumentDetails.bank_ifsc || null,
    phone:
      contactDetails.beneficiaryPhone ||
      contactDetails.beneficiary_phone ||
      null,
    address:
      contactDetails.beneficiaryAddress ||
      contactDetails.beneficiary_address ||
      null,
    city:
      contactDetails.beneficiaryCity || contactDetails.beneficiary_city || null,
    state:
      contactDetails.beneficiaryState || contactDetails.beneficiary_state || null,
    postalCode:
      contactDetails.beneficiaryPostalCode ||
      contactDetails.beneficiary_postal_code ||
      null,
    addedAt: beneficiary.addedOn || beneficiary.added_on || null
  }
}

const createBeneficiary = async (req, res, next) => {
  try {
    const body = req.body || {}
    const payeeId = safeObjectIdString(body.payeeId)
    const name = String(body.name || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const phone = String(body.phone || '').trim()
    const bankAccount = String(body.bankAccount || '').trim()
    const ifsc = String(body.ifsc || '').trim().toUpperCase()
    const address = {
      address1: String(body.address1 || body.address || body.beneficiaryAddress || '').trim(),
      city: String(body.city || body.beneficiaryCity || '').trim(),
      state: String(body.state || body.beneficiaryState || '').trim(),
      pincode: String(body.pincode || body.postalCode || body.beneficiaryPostalCode || '').trim(),
      country: String(body.country || body.countryCode || body.beneficiaryCountry || 'IN').trim().toUpperCase()
    }

    if (!payeeId) {
      return res.status(400).json({ success: false, message: 'payeeId is required' })
    }

    if (!name || !phone || !bankAccount || !ifsc) {
      return res.status(400).json({
        success: false,
        message: 'name, phone, bankAccount, and ifsc are required'
      })
    }

    if (req.user?.userType !== 'admin' && safeObjectIdString(req.user?.id) !== payeeId) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const result = await registerBeneficiary(
      { payeeId, name, email, phone, bankAccount, ifsc, address },
      req.fetch || global.fetch
    )

    return res.status(201).json({
      success: true,
      message: 'Beneficiary created successfully',
      data: {
        payee: result.payeeSnapshot,
        beneId: result.beneId,
        validation: result.validation,
        verificationWarning: result.verificationWarning
      }
    })
  } catch (error) {
    if (error.details) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
        details: error.details
      })
    }
    next(error)
  }
}

const getBeneficiary = async (req, res, next) => {
  try {
    const payload = parseBeneficiaryRequest({
      ...(req.query || {}),
      ...(req.body || {})
    })

    const localLookup = payload.payeeId
      ? await findPayeeRecordById(payload.payeeId)
      : payload.beneficiaryId
      ? await findPayeeRecordByBeneficiaryId(payload.beneficiaryId)
      : { payee: null, modelName: null }

    if (localLookup.payee && !hasBeneficiaryAccess(req, localLookup.payee)) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    if (!localLookup.payee && req.user?.userType !== 'admin') {
      return res.status(404).json({ success: false, message: 'Beneficiary not found' })
    }

    const result = await getRegisteredBeneficiary(payload, req.fetch || global.fetch)
    const normalizedBeneficiary = normalizeBeneficiaryForFrontend(
      result.beneficiary
    )

    return res.status(200).json({
      success: true,
      data: normalizedBeneficiary
    })
  } catch (error) {
    if (error.details) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
        details: error.details
      })
    }
    next(error)
  }
}

const removeBeneficiary = async (req, res, next) => {
  try {
    const payload = parseBeneficiaryRequest({
      ...(req.query || {}),
      ...(req.body || {})
    })

    const localLookup = payload.payeeId
      ? await findPayeeRecordById(payload.payeeId)
      : payload.beneficiaryId
      ? await findPayeeRecordByBeneficiaryId(payload.beneficiaryId)
      : { payee: null, modelName: null }

    if (localLookup.payee && !hasBeneficiaryAccess(req, localLookup.payee)) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    if (!localLookup.payee && req.user?.userType !== 'admin') {
      return res.status(404).json({ success: false, message: 'Beneficiary not found' })
    }

    const result = await removeRegisteredBeneficiary(payload, req.fetch || global.fetch)
    const normalizedBeneficiary = normalizeBeneficiaryForFrontend(
      result.beneficiary
    )

    return res.status(200).json({
      success: true,
      message: 'Beneficiary removed successfully',
      data: normalizedBeneficiary
    })
  } catch (error) {
    if (error.details) {
      return res.status(error.statusCode || 400).json({
        success: false,
        message: error.message,
        details: error.details
      })
    }
    next(error)
  }
}

const createPayout = async (req, res, next) => {
  try {
    const body = req.body || {}
    const paymentId = safeObjectIdString(body.paymentId)
    const payeeId = safeObjectIdString(body.payeeId)
    const currency = String(body.currency || 'INR').trim().toUpperCase()
    const referenceType = String(body.referenceType || '').trim() || null
    const referenceId = String(body.referenceId || '').trim() || null
    const payeeType = String(body.payeeType || '').trim() || null

    if (!paymentId && !payeeId) {
      return res.status(400).json({
        success: false,
        message: 'paymentId or payeeId is required'
      })
    }

    let payment = null
    if (paymentId && mongoose.Types.ObjectId.isValid(paymentId)) {
      payment = await PaymentSession.findById(paymentId)
    }

    if (payment && payment.status !== 'SUCCESS') {
      return res.status(400).json({
        success: false,
        message: 'Payment must be successful before creating payout'
      })
    }

    const amount = normalizeMoney(body.amount || payment?.amount)

    const payerId =
      safeObjectIdString(body.payerId) ||
      safeObjectIdString(payment?.payer?.userId) ||
      safeObjectIdString(payment?.initiatedBy?.userId) ||
      null

    const effectivePayeeId = payeeId || safeObjectIdString(payment?.metadata?.payout?.payeeId)

    if (!effectivePayeeId) {
      return res.status(400).json({
        success: false,
        message: 'payeeId is required'
      })
    }

    const payout = await createPayoutRecord({
      payerId,
      payeeId: effectivePayeeId,
      payeeType,
      paymentId: payment?._id || paymentId || null,
      referenceType: referenceType || payment?.referenceType || null,
      referenceId: referenceId || payment?.referenceId || null,
      amount,
      currency,
      cashfree: {
        beneId: body.beneId || null,
        transferMode: String(body.transferMode || 'IMPS').trim().toUpperCase()
      }
    })

    const started = await startPayoutTransfer(payout, { fetchImpl: req.fetch || global.fetch })

    return res.status(201).json({
      success: true,
      message: 'Payout created successfully',
      data: {
        payout: serializePayout(started)
      }
    })
  } catch (error) {
    next(error)
  }
}

const getPayoutStatus = async (req, res, next) => {
  try {
    const payout = await getPayoutById(req.params.id)
    if (!payout) {
      return res.status(404).json({ success: false, message: 'Payout not found' })
    }

    if (!assertPayoutAccess(payout, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    return res.status(200).json({
      success: true,
      data: {
        payout: serializePayout(payout),
        message: buildPayoutStatusMessage(payout)
      }
    })
  } catch (error) {
    next(error)
  }
}

const getPayoutByPayment = async (req, res, next) => {
  try {
    const paymentId = String(req.params.paymentId || '').trim()
    const payout = await Payout.findOne({ paymentId })
    if (!payout) {
      return res.status(404).json({ success: false, message: 'Payout not found' })
    }

    if (!assertPayoutAccess(payout, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    return res.status(200).json({
      success: true,
      data: {
        payout: serializePayout(payout),
        message: buildPayoutStatusMessage(payout)
      }
    })
  } catch (error) {
    next(error)
  }
}

const handleCashfreeWebhook = async (req, res, next) => {
  try {
    const incomingSignature = String(req.headers['x-webhook-signature'] || req.headers['X-Webhook-Signature'] || '').trim()
    const requestBodyIsEmpty =
      !req.rawBody ||
      !String(req.rawBody).trim() ||
      (req.body && typeof req.body === 'object' && Object.keys(req.body).length === 0)

    if (req.method === 'GET' || !incomingSignature) {
      return res.status(200).json({
        success: true,
        message: 'Cashfree payout webhook endpoint reachable'
      })
    }

    const payout = await handleCashfreePayoutWebhook({
      body: { ...(req.query || {}), ...(req.body || {}) },
      headers: req.headers,
      rawBody: req.rawBody || '',
      fetchImpl: req.fetch || global.fetch
    })

    return res.status(200).json({
      success: true,
      message: 'Cashfree payout webhook processed successfully',
      data: {
        payout: serializePayout(payout)
      }
    })
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message
      })
    }
    next(error)
  }
}

const retryPayout = async (req, res, next) => {
  try {
    if (req.user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const payout = await getPayoutById(req.params.id)
    if (!payout) {
      return res.status(404).json({ success: false, message: 'Payout not found' })
    }

    const updated = await startPayoutTransfer(payout, { fetchImpl: req.fetch || global.fetch })

    return res.status(200).json({
      success: true,
      message: 'Payout retry started',
      data: { payout: serializePayout(updated) }
    })
  } catch (error) {
    next(error)
  }
}

const cancelPayout = async (req, res, next) => {
  try {
    if (req.user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const payout = await getPayoutById(req.params.id)
    if (!payout) {
      return res.status(404).json({ success: false, message: 'Payout not found' })
    }

    if (payout.status === 'SUCCESS') {
      return res.status(400).json({
        success: false,
        message: 'Successful payouts cannot be cancelled'
      })
    }

    payout.status = 'CANCELLED'
    payout.completedAt = new Date()
    payout.failure = {
      code: 'CANCELLED',
      message: 'Payout cancelled by admin',
      reason: 'Payout cancelled by admin',
      isRetryable: false
    }
    payout.retry = {
      ...(payout.retry || {}),
      nextRetryAt: null
    }
    await payout.save()

    return res.status(200).json({
      success: true,
      message: 'Payout cancelled successfully',
      data: { payout: serializePayout(payout) }
    })
  } catch (error) {
    next(error)
  }
}

const getAdminPayoutSummary = async (req, res, next) => {
  try {
    if (req.user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const summary = await getPayoutSummary()
    return res.status(200).json({
      success: true,
      data: summary
    })
  } catch (error) {
    next(error)
  }
}

const listPayouts = async (req, res, next) => {
  try {
    const query = {}
    if (req.query.status) {
      query.status = String(req.query.status).trim().toUpperCase()
    }
    if (req.query.paymentId) {
      query.paymentId = req.query.paymentId
    }

    const payouts = await Payout.find(query).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit) || 25, 100))
    return res.status(200).json({
      success: true,
      data: {
        payouts: payouts.map((payout) => serializePayout(payout)),
        count: payouts.length
      }
    })
  } catch (error) {
    next(error)
  }
}

const triggerAutomaticPayout = async (req, res, next) => {
  try {
    const paymentId = String(req.params.paymentId || '').trim()
    const payment = await PaymentSession.findById(paymentId)
    if (!payment) {
      return res.status(404).json({ success: false, message: 'Payment not found' })
    }

    if (!assertPayoutAccess({ payerId: payment.payer?.userId, payeeId: payment.metadata?.payout?.payeeId }, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const payout = await createAutomaticPayoutForPayment(payment, { fetchImpl: req.fetch || global.fetch })

    return res.status(200).json({
      success: true,
      message: payout ? 'Automatic payout flow started' : 'No payout metadata found for this payment',
      data: {
        payout: payout ? serializePayout(payout) : null
      }
    })
  } catch (error) {
    next(error)
  }
}

const runRetryCronNow = async (req, res, next) => {
  try {
    if (req.user?.userType !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied' })
    }

    const processed = await processDuePayoutRetries({ fetchImpl: req.fetch || global.fetch })
    return res.status(200).json({
      success: true,
      message: 'Payout retry cron executed',
      data: {
        processed: processed.map((payout) => serializePayout(payout))
      }
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  cancelPayout,
  createBeneficiary,
  createPayout,
  getAdminPayoutSummary,
  getBeneficiary,
  getPayoutByPayment,
  getPayoutStatus,
  handleCashfreeWebhook,
  listPayouts,
  retryPayout,
  runRetryCronNow,
  removeBeneficiary,
  triggerAutomaticPayout
}
