const Transporter = require('../models/Transporter')
const {
  validatePAN,
  normalizePAN,
  validateAadhaar,
  cleanAadhaar,
  validateIFSC
} = require('../utils/validation')
const { deleteCache, deleteCachePattern } = require('../utils/cache')
const logger = require('../utils/logger')

/**
 * Format document URL (returns absolute URL and relative path)
 */
const formatDocUrl = (req, filePath) => {
  if (!filePath) return null
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }
  const cleanPath = filePath.startsWith('/') ? filePath : `/${filePath}`
  const baseUrl = `${req.protocol}://${req.get('host')}`
  return `${baseUrl}${cleanPath}`
}

/**
 * Helper to check if bank details are registered
 */
const checkBankDetailsStatus = (transporter) => {
  const bank = transporter.kyc?.bankDetails || {}
  const hasDirectBank = Boolean(bank.accountNumber || bank.isAdded)
  const hasCashfree = Boolean(
    transporter.cashfreeBeneficiary?.beneId || transporter.cashfreeBeneId
  )
  const hasRazorpay = Boolean(
    transporter.razorpayBeneficiary?.fundAccountId
  )

  const isAdded = hasDirectBank || hasCashfree || hasRazorpay
  const bankAccountLast4 =
    bank.bankAccountLast4 ||
    transporter.cashfreeBeneficiary?.bankAccountLast4 ||
    transporter.razorpayBeneficiary?.bankAccountLast4 ||
    (bank.accountNumber ? bank.accountNumber.slice(-4) : null)

  return {
    isAdded,
    accountHolderName:
      bank.accountHolderName ||
      transporter.cashfreeBeneficiary?.name ||
      transporter.name ||
      null,
    bankAccountLast4,
    ifscCode: bank.ifscCode || null,
    bankName: bank.bankName || null,
    source: hasCashfree ? 'cashfree' : hasRazorpay ? 'razorpay' : 'direct'
  }
}

/**
 * Format KYC response for client
 */
const formatKycResponse = (req, transporter) => {
  const kyc = transporter.kyc || {}
  const bankDetails = checkBankDetailsStatus(transporter)
  const isCompleted = kyc.status === 'completed' || kyc.isCompleted === true

  return {
    status: kyc.status || 'pending',
    isCompleted,
    panNumber: kyc.panNumber || null,
    panImage: formatDocUrl(req, kyc.panImage),
    panImagePath: kyc.panImage || null,
    panUploadedAt: kyc.panUploadedAt || null,
    aadhaarNumber: kyc.aadhaarNumber || null,
    aadhaarImage: formatDocUrl(req, kyc.aadhaarImage),
    aadhaarImagePath: kyc.aadhaarImage || null,
    aadhaarBackImage: formatDocUrl(req, kyc.aadhaarBackImage),
    aadhaarBackImagePath: kyc.aadhaarBackImage || null,
    aadhaarUploadedAt: kyc.aadhaarUploadedAt || null,
    bankDetails,
    submittedAt: kyc.submittedAt || null,
    updatedAt: kyc.updatedAt || null,
    adminReviewed: Boolean(kyc.adminReviewed),
    adminReviewedAt: kyc.adminReviewedAt || null,
    adminNotes: kyc.adminNotes || null,
    networkAccessGranted: Boolean(isCompleted && transporter.hasAccess)
  }
}

/**
 * Invalidate transporter caches
 */
const invalidateTransporterCache = async (transporterId) => {
  try {
    await deleteCache(`transporter:profile:${transporterId}`)
    await deleteCache(`transporter:dashboard:${transporterId}`)
    await deleteCachePattern('admin:transporters:*')
    await deleteCachePattern('admin:transporters-with-vehicles:*')
    await deleteCachePattern('admin:dashboard-stats:*')
    await deleteCachePattern('admin:analytics:*')
  } catch (error) {
    logger.error('Error invalidating transporter cache:', error)
  }
}

/**
 * Get transporter KYC status & documents
 * GET /api/transporters/kyc
 */
const getKycStatus = async (req, res, next) => {
  try {
    const transporter = await Transporter.findById(req.user.id).select('-pin')

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found'
      })
    }

    const kycData = formatKycResponse(req, transporter)

    return res.status(200).json({
      success: true,
      message: 'KYC details retrieved successfully',
      data: {
        kyc: kycData
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Submit or update KYC documents
 * POST /api/transporters/kyc
 * PUT /api/transporters/kyc
 */
const submitOrUpdateKyc = async (req, res, next) => {
  try {
    const transporterId = req.user.id
    const transporter = await Transporter.findById(transporterId)

    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found'
      })
    }

    // Initialize kyc object if not existing
    if (!transporter.kyc) {
      transporter.kyc = { status: 'pending', isCompleted: false }
    }

    const {
      panNumber,
      pan,
      aadhaarNumber,
      aadhaar,
      panImage: panImageUrl,
      aadhaarImage: aadhaarImageUrl,
      aadhaarBackImage: aadhaarBackImageUrl,
      accountHolderName,
      accountNumber,
      ifscCode,
      bankName
    } = req.body

    // 1. Process PAN Number
    const rawPan = panNumber || pan
    if (rawPan !== undefined) {
      const normalizedPan = normalizePAN(rawPan)
      if (normalizedPan && !validatePAN(normalizedPan)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid PAN number format. PAN must be 10 characters (e.g., ABCDE1234F).'
        })
      }
      transporter.kyc.panNumber = normalizedPan
    }

    // 2. Process Aadhaar Number
    const rawAadhaar = aadhaarNumber || aadhaar
    if (rawAadhaar !== undefined) {
      const cleanedAadhaar = cleanAadhaar(rawAadhaar)
      if (cleanedAadhaar && !validateAadhaar(cleanedAadhaar)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid Aadhaar number format. Aadhaar must be 12 digits.'
        })
      }
      transporter.kyc.aadhaarNumber = cleanedAadhaar
    }

    // 3. Process Uploaded Files or URLs
    const files = req.files || {}

    // PAN image
    if (files.panImage?.[0] || files.pan?.[0]) {
      const file = files.panImage?.[0] || files.pan?.[0]
      transporter.kyc.panImage = `/uploads/kyc/${file.filename}`
      transporter.kyc.panUploadedAt = new Date()
    } else if (panImageUrl !== undefined) {
      transporter.kyc.panImage = panImageUrl?.trim() || null
      if (panImageUrl?.trim()) {
        transporter.kyc.panUploadedAt = new Date()
      }
    }

    // Aadhaar front image
    if (files.aadhaarImage?.[0] || files.aadhaar?.[0]) {
      const file = files.aadhaarImage?.[0] || files.aadhaar?.[0]
      transporter.kyc.aadhaarImage = `/uploads/kyc/${file.filename}`
      transporter.kyc.aadhaarUploadedAt = new Date()
    } else if (aadhaarImageUrl !== undefined) {
      transporter.kyc.aadhaarImage = aadhaarImageUrl?.trim() || null
      if (aadhaarImageUrl?.trim()) {
        transporter.kyc.aadhaarUploadedAt = new Date()
      }
    }

    // Aadhaar back image (optional)
    if (files.aadhaarBackImage?.[0]) {
      const file = files.aadhaarBackImage[0]
      transporter.kyc.aadhaarBackImage = `/uploads/kyc/${file.filename}`
    } else if (aadhaarBackImageUrl !== undefined) {
      transporter.kyc.aadhaarBackImage = aadhaarBackImageUrl?.trim() || null
    }

    // 4. Process Bank Details (if provided)
    if (accountNumber || ifscCode || accountHolderName || bankName) {
      if (!transporter.kyc.bankDetails) {
        transporter.kyc.bankDetails = {}
      }

      if (ifscCode) {
        const cleanIfsc = ifscCode.trim().toUpperCase()
        if (!validateIFSC(cleanIfsc)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid IFSC code format (e.g., HDFC0001234).'
          })
        }
        transporter.kyc.bankDetails.ifscCode = cleanIfsc
      }

      if (accountNumber) {
        const cleanAcc = String(accountNumber).trim()
        transporter.kyc.bankDetails.accountNumber = cleanAcc
        transporter.kyc.bankDetails.bankAccountLast4 = cleanAcc.slice(-4)
        transporter.kyc.bankDetails.isAdded = true
      }

      if (accountHolderName) {
        transporter.kyc.bankDetails.accountHolderName = accountHolderName.trim()
      }

      if (bankName) {
        transporter.kyc.bankDetails.bankName = bankName.trim()
      }
    }

    // Check if bank details are already verified via payout beneficiary
    const bankStatus = checkBankDetailsStatus(transporter)
    if (bankStatus.isAdded && transporter.kyc.bankDetails) {
      transporter.kyc.bankDetails.isAdded = true
    }

    // 5. Verification & Auto-completion check
    const hasPanNumber = Boolean(transporter.kyc.panNumber)
    const hasPanImage = Boolean(transporter.kyc.panImage)
    const hasAadhaarNumber = Boolean(transporter.kyc.aadhaarNumber)
    const hasAadhaarImage = Boolean(transporter.kyc.aadhaarImage)

    // When documents are uploaded, auto-complete KYC without requiring admin approval
    const isReadyForCompletion =
      hasPanNumber && hasPanImage && hasAadhaarNumber && hasAadhaarImage

    if (isReadyForCompletion) {
      transporter.kyc.status = 'completed'
      transporter.kyc.isCompleted = true
      transporter.hasAccess = true // Grant marketplace & network access immediately

      if (!transporter.kyc.submittedAt) {
        transporter.kyc.submittedAt = new Date()
      }
      transporter.kyc.updatedAt = new Date()
    } else {
      // Still pending documents
      transporter.kyc.updatedAt = new Date()
    }

    await transporter.save()

    // Invalidate cache
    await invalidateTransporterCache(transporterId)

    const responseKyc = formatKycResponse(req, transporter)

    return res.status(200).json({
      success: true,
      message: isReadyForCompletion
        ? 'KYC completed successfully! You now have full access to the network and marketplace.'
        : 'KYC documents saved. Please provide remaining documents to complete verification.',
      data: {
        kyc: responseKyc
      }
    })
  } catch (error) {
    next(error)
  }
}

/**
 * Upload single document (e.g. for preview before submission)
 * POST /api/transporters/kyc/upload
 */
const uploadSingleKycDoc = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No document file uploaded. Use field name "document".'
      })
    }

    const relativePath = `/uploads/kyc/${req.file.filename}`
    const fullUrl = formatDocUrl(req, relativePath)

    return res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        filename: req.file.filename,
        path: relativePath,
        url: fullUrl,
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getKycStatus,
  submitOrUpdateKyc,
  uploadSingleKycDoc,
  formatDocUrl,
  checkBankDetailsStatus
}

