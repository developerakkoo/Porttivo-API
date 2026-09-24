const Transporter = require('../models/Transporter')
const { deleteCache, deleteCachePattern } = require('../utils/cache')
const logger = require('../utils/logger')
const {
  ensureKyc,
  applyKycInput,
  applyCompletionState,
  serializeKyc,
  buildPublicFileUrl
} = require('../services/kyc.service')

const invalidateTransporterCaches = async (transporterId) => {
  await deleteCache(`transporter:profile:${transporterId}`)
  await deleteCachePattern('admin:transporters:*')
}

const loadTransporter = async (id) => {
  const transporter = await Transporter.findById(id)
  if (!transporter) return null
  transporter.kyc = ensureKyc(transporter)
  return transporter
}

const getKyc = async (req, res, next) => {
  try {
    const transporter = await loadTransporter(req.user.id)
    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found'
      })
    }

    return res.status(200).json({
      success: true,
      message: 'KYC details retrieved successfully',
      data: {
        kyc: serializeKyc(transporter, req)
      }
    })
  } catch (error) {
    next(error)
  }
}

const upsertKyc = async (req, res, next) => {
  try {
    const transporter = await loadTransporter(req.user.id)
    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found'
      })
    }

    const kyc = ensureKyc(transporter)
    const errors = applyKycInput(kyc, {
      body: req.body || {},
      files: req.files || null
    })

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors[0]
      })
    }

    const completed = applyCompletionState(transporter, kyc)
    transporter.kyc = kyc
    if (typeof transporter.markModified === 'function') {
      transporter.markModified('kyc')
    }
    await transporter.save()
    await invalidateTransporterCaches(transporter._id)

    logger.info('TRANSPORTER KYC UPSERT', {
      transporterId: String(transporter._id),
      status: kyc.status,
      isCompleted: kyc.isCompleted
    })

    return res.status(200).json({
      success: true,
      message: completed
        ? 'KYC completed successfully! You now have full access to the network and marketplace.'
        : 'KYC details saved',
      data: {
        kyc: serializeKyc(transporter, req)
      }
    })
  } catch (error) {
    next(error)
  }
}

const uploadKycDocument = async (req, res, next) => {
  try {
    if (!req.file?.filename) {
      return res.status(400).json({
        success: false,
        message: 'Document file is required'
      })
    }

    const relativePath = `/uploads/kyc/${req.file.filename}`
    return res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        filename: req.file.filename,
        path: relativePath,
        url: buildPublicFileUrl(req, relativePath),
        size: req.file.size,
        mimetype: req.file.mimetype
      }
    })
  } catch (error) {
    next(error)
  }
}

const reviewTransporterKyc = async (req, res, next) => {
  try {
    const { status, adminNotes, hasAccess } = req.body || {}
    if (!['pending', 'completed', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (pending, completed, rejected)'
      })
    }

    const transporter = await loadTransporter(req.params.id)
    if (!transporter) {
      return res.status(404).json({
        success: false,
        message: 'Transporter not found'
      })
    }

    const kyc = ensureKyc(transporter)
    kyc.status = status
    kyc.isCompleted = status === 'completed'
    kyc.adminReviewed = true
    kyc.adminReviewedAt = new Date()
    if (adminNotes != null) {
      kyc.adminNotes = String(adminNotes).trim() || null
    }
    kyc.updatedAt = new Date()

    if (typeof hasAccess === 'boolean') {
      transporter.hasAccess = hasAccess
    } else if (status === 'completed') {
      transporter.hasAccess = true
    } else if (status === 'rejected') {
      transporter.hasAccess = false
    }

    transporter.kyc = kyc
    await transporter.save()
    await invalidateTransporterCaches(transporter._id)

    return res.status(200).json({
      success: true,
      message: 'KYC review updated',
      data: {
        kyc: serializeKyc(transporter, req),
        hasAccess: transporter.hasAccess
      }
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  getKyc,
  upsertKyc,
  uploadKycDocument,
  reviewTransporterKyc
}
