const Transporter = require('../models/Transporter')
const { kycRequiredPayload, hasRequiredDocuments, ensureKyc } = require('../services/kyc.service')

const isTransporterKycComplete = (transporter) => {
  if (!transporter) return false
  const kyc = ensureKyc(transporter)
  return kyc.isCompleted === true || kyc.status === 'completed' || hasRequiredDocuments(kyc)
}

const requireTransporterKyc = async (req, res, next) => {
  try {
    if (req.user?.userType !== 'transporter') {
      return next()
    }

    const transporter =
      req.user?.userData || (await Transporter.findById(req.user.id).select('kyc hasAccess'))

    if (isTransporterKycComplete(transporter)) {
      return next()
    }

    return res.status(403).json(kycRequiredPayload(transporter))
  } catch (error) {
    next(error)
  }
}

module.exports = {
  requireTransporterKyc,
  isTransporterKycComplete
}
