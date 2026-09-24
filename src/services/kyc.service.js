const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/
const AADHAAR_PATTERN = /^\d{12}$/
const KYC_REQUIRED_MESSAGE =
  'KYC verification required. Please complete your KYC to access the network and marketplace.'

const emptyBankDetails = () => ({
  isAdded: false,
  accountHolderName: null,
  bankAccountLast4: null,
  ifscCode: null,
  bankName: null,
  source: null
})

const emptyKyc = () => ({
  status: 'pending',
  isCompleted: false,
  panNumber: null,
  panImagePath: null,
  panUploadedAt: null,
  aadhaarNumber: null,
  aadhaarImagePath: null,
  aadhaarBackImagePath: null,
  aadhaarUploadedAt: null,
  bankDetails: emptyBankDetails(),
  submittedAt: null,
  updatedAt: null,
  adminReviewed: false,
  adminReviewedAt: null,
  adminNotes: null
})

const firstNonEmpty = (...values) => {
  for (const value of values) {
    if (value == null) continue
    const text = String(value).trim()
    if (text) return text
  }
  return null
}

const normalizePan = (value) => String(value || '').trim().toUpperCase()

const normalizeAadhaar = (value) => String(value || '').replace(/\s+/g, '').trim()

const extractAccountLast4 = (value) => {
  const digits = String(value || '').replace(/\D/g, '')
  if (digits.length < 4) return null
  return digits.slice(-4)
}

const isPresent = (value) => {
  if (value == null) return false
  return String(value).trim().length > 0
}

const hasRequiredDocuments = (kyc = {}) =>
  isPresent(kyc.panNumber) &&
  isPresent(kyc.panImagePath) &&
  isPresent(kyc.aadhaarNumber) &&
  isPresent(kyc.aadhaarImagePath)

const validatePanNumber = (value, { required = false } = {}) => {
  const pan = normalizePan(value)
  if (!pan) {
    return required ? { error: 'PAN number is required' } : { value: null }
  }
  if (pan.length !== 10 || !PAN_PATTERN.test(pan)) {
    return { error: 'Enter a valid 10-character PAN number' }
  }
  return { value: pan }
}

const validateAadhaarNumber = (value, { required = false } = {}) => {
  const aadhaar = normalizeAadhaar(value)
  if (!aadhaar) {
    return required ? { error: 'Aadhaar number is required' } : { value: null }
  }
  if (!AADHAAR_PATTERN.test(aadhaar)) {
    return { error: 'Enter a valid 12-digit Aadhaar number' }
  }
  return { value: aadhaar }
}

const ensureKyc = (transporter) => {
  const current = transporter?.kyc
  if (!current || typeof current !== 'object') {
    return emptyKyc()
  }

  return {
    ...emptyKyc(),
    ...current,
    bankDetails: {
      ...emptyBankDetails(),
      ...(current.bankDetails || {})
    }
  }
}

const normalizeStoredImage = (value) => {
  const raw = firstNonEmpty(value)
  if (!raw) return null
  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw)
      if (parsed.pathname.startsWith('/uploads/')) {
        return parsed.pathname
      }
    } catch (_) {
      return raw
    }
    return raw
  }
  return raw.startsWith('/') ? raw : `/${raw}`
}

const buildPublicFileUrl = (req, stored) => {
  const normalized = normalizeStoredImage(stored)
  if (!normalized) return null
  if (/^https?:\/\//i.test(normalized)) return normalized

  const proto = String(
    req?.headers?.['x-forwarded-proto'] || req?.protocol || 'https'
  )
    .split(',')[0]
    .trim()
  const host = String(
    req?.get?.('host') ||
      req?.headers?.['x-forwarded-host'] ||
      req?.headers?.host ||
      ''
  )
    .split(',')[0]
    .trim()

  if (!host) return normalized
  return `${proto}://${host}${normalized}`
}

const applyCompletionState = (transporter, kyc) => {
  const complete = hasRequiredDocuments(kyc)
  if (complete) {
    kyc.status = 'completed'
    kyc.isCompleted = true
    transporter.hasAccess = true
  } else if (kyc.status !== 'rejected') {
    kyc.status = 'pending'
    kyc.isCompleted = false
  }
  return complete
}

const applyBankDetails = (kyc, body = {}) => {
  const accountHolderName = firstNonEmpty(
    body.accountHolderName,
    body.account_holder_name
  )
  const accountNumber = firstNonEmpty(
    body.accountNumber,
    body.account_number,
    body.bankAccount,
    body.bankAccountNumber
  )
  const ifscCode = firstNonEmpty(body.ifscCode, body.ifsc, body.bankIfsc)
  const bankName = firstNonEmpty(body.bankName, body.bank_name)
  const last4 = extractAccountLast4(accountNumber)

  if (!accountHolderName && !last4 && !ifscCode && !bankName) {
    return kyc.bankDetails
  }

  kyc.bankDetails = {
    ...emptyBankDetails(),
    ...kyc.bankDetails,
    isAdded: true,
    accountHolderName: accountHolderName || kyc.bankDetails.accountHolderName,
    bankAccountLast4: last4 || kyc.bankDetails.bankAccountLast4,
    ifscCode: ifscCode ? ifscCode.toUpperCase() : kyc.bankDetails.ifscCode,
    bankName: bankName || kyc.bankDetails.bankName,
    source: 'direct'
  }
  return kyc.bankDetails
}

const resolveBankDetails = (transporter, kyc) => {
  const stored = {
    ...emptyBankDetails(),
    ...(kyc?.bankDetails || {})
  }
  if (stored.isAdded) return stored

  const razorpay = transporter?.razorpayBeneficiary || {}
  const last4 = firstNonEmpty(razorpay.bankAccountLast4)
  const fundAccountId = firstNonEmpty(razorpay.fundAccountId)
  if (!fundAccountId && !last4) return stored

  return {
    isAdded: true,
    accountHolderName: firstNonEmpty(transporter?.name) || null,
    bankAccountLast4: last4,
    ifscCode: null,
    bankName: null,
    source: 'razorpay'
  }
}

const firstUploadedFile = (files, field) => {
  if (!files) return null
  if (Array.isArray(files[field]) && files[field][0]) return files[field][0]
  if (files[field] && files[field].filename) return files[field]
  return null
}

const applyUploadedFile = (kyc, files, field, pathField, uploadedAtField) => {
  const file = firstUploadedFile(files, field)
  if (!file?.filename) return false
  kyc[pathField] = `/uploads/kyc/${file.filename}`
  if (uploadedAtField) {
    kyc[uploadedAtField] = new Date()
  }
  return true
}

const applyKycInput = (kyc, { body = {}, files = null } = {}) => {
  const errors = []

  if (body.panNumber != null || body.pan_number != null) {
    const pan = validatePanNumber(body.panNumber ?? body.pan_number)
    if (pan.error) errors.push(pan.error)
    else kyc.panNumber = pan.value
  }

  if (body.aadhaarNumber != null || body.aadhaar_number != null) {
    const aadhaar = validateAadhaarNumber(
      body.aadhaarNumber ?? body.aadhaar_number
    )
    if (aadhaar.error) errors.push(aadhaar.error)
    else kyc.aadhaarNumber = aadhaar.value
  }

  if (body.panImage != null || body.pan_image != null) {
    const pathValue = normalizeStoredImage(body.panImage ?? body.pan_image)
    if (pathValue) {
      kyc.panImagePath = pathValue
      kyc.panUploadedAt = kyc.panUploadedAt || new Date()
    }
  }

  if (body.aadhaarImage != null || body.aadhaar_image != null) {
    const pathValue = normalizeStoredImage(
      body.aadhaarImage ?? body.aadhaar_image
    )
    if (pathValue) {
      kyc.aadhaarImagePath = pathValue
      kyc.aadhaarUploadedAt = kyc.aadhaarUploadedAt || new Date()
    }
  }

  if (body.aadhaarBackImage != null || body.aadhaar_back_image != null) {
    const pathValue = normalizeStoredImage(
      body.aadhaarBackImage ?? body.aadhaar_back_image
    )
    kyc.aadhaarBackImagePath = pathValue
  }

  applyUploadedFile(kyc, files, 'panImage', 'panImagePath', 'panUploadedAt')
  applyUploadedFile(
    kyc,
    files,
    'aadhaarImage',
    'aadhaarImagePath',
    'aadhaarUploadedAt'
  )
  applyUploadedFile(kyc, files, 'aadhaarBackImage', 'aadhaarBackImagePath', null)

  applyBankDetails(kyc, body)

  if (
    !kyc.submittedAt &&
    (kyc.panNumber ||
      kyc.aadhaarNumber ||
      kyc.panImagePath ||
      kyc.aadhaarImagePath)
  ) {
    kyc.submittedAt = new Date()
  }
  kyc.updatedAt = new Date()

  return errors
}

const serializeKyc = (transporter, req) => {
  const kyc = ensureKyc(transporter)
  const bankDetails = resolveBankDetails(transporter, kyc)
  const isCompleted = kyc.isCompleted === true || kyc.status === 'completed'

  return {
    status: kyc.status || 'pending',
    isCompleted,
    panNumber: kyc.panNumber || null,
    panImage: buildPublicFileUrl(req, kyc.panImagePath),
    panImagePath: normalizeStoredImage(kyc.panImagePath),
    panUploadedAt: kyc.panUploadedAt || null,
    aadhaarNumber: kyc.aadhaarNumber || null,
    aadhaarImage: buildPublicFileUrl(req, kyc.aadhaarImagePath),
    aadhaarImagePath: normalizeStoredImage(kyc.aadhaarImagePath),
    aadhaarBackImage: buildPublicFileUrl(req, kyc.aadhaarBackImagePath),
    aadhaarBackImagePath: normalizeStoredImage(kyc.aadhaarBackImagePath),
    aadhaarUploadedAt: kyc.aadhaarUploadedAt || null,
    bankDetails,
    submittedAt: kyc.submittedAt || null,
    updatedAt: kyc.updatedAt || null,
    adminReviewed: kyc.adminReviewed === true,
    adminReviewedAt: kyc.adminReviewedAt || null,
    adminNotes: kyc.adminNotes || null,
    networkAccessGranted: isCompleted && transporter?.hasAccess !== false
  }
}

const profileKycFields = (transporter) => {
  const kyc = ensureKyc(transporter)
  const isCompleted = kyc.isCompleted === true || kyc.status === 'completed'
  return {
    kycStatus: kyc.status || 'pending',
    isKycCompleted: isCompleted,
    kycMessage: isCompleted ? null : KYC_REQUIRED_MESSAGE
  }
}

const kycRequiredPayload = (transporter) => {
  const fields = profileKycFields(transporter)
  return {
    success: false,
    code: 'KYC_REQUIRED',
    message: KYC_REQUIRED_MESSAGE,
    data: {
      kycStatus: fields.kycStatus,
      isKycCompleted: false
    }
  }
}

module.exports = {
  PAN_PATTERN,
  AADHAAR_PATTERN,
  KYC_REQUIRED_MESSAGE,
  emptyKyc,
  ensureKyc,
  hasRequiredDocuments,
  validatePanNumber,
  validateAadhaarNumber,
  normalizePan,
  normalizeAadhaar,
  normalizeStoredImage,
  buildPublicFileUrl,
  applyCompletionState,
  applyKycInput,
  serializeKyc,
  profileKycFields,
  kycRequiredPayload,
  resolveBankDetails,
  extractAccountLast4
}
