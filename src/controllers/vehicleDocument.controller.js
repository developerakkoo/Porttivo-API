const Vehicle = require('../models/Vehicle');

/**
 * Upload vehicle document
 * POST /api/vehicles/:id/documents
 */
const uploadDocument = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { documentType, url, expiryDate } = req.body;

    // Only transporters can upload documents
    if (req.user.userType !== 'transporter') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters can upload documents.',
      });
    }

    // Validate document type
    const validDocumentTypes = ['rc', 'insurance', 'fitness', 'permit'];
    if (!documentType || !validDocumentTypes.includes(documentType.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `Invalid document type. Must be one of: ${validDocumentTypes.join(', ')}`,
      });
    }

    // Validate URL
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'Document URL is required',
      });
    }

    // Validate expiry date
    let expiryDateObj = null;
    if (expiryDate) {
      expiryDateObj = new Date(expiryDate);
      if (isNaN(expiryDateObj.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid expiry date format',
        });
      }
    }

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Check ownership
    if (vehicle.transporterId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this vehicle.',
      });
    }

    // Update document
    const docType = documentType.toLowerCase();
    vehicle.documents[docType] = {
      url: url.trim(),
      expiryDate: expiryDateObj,
      uploadedAt: new Date(),
    };

    await vehicle.save();

    return res.status(200).json({
      success: true,
      message: 'Document uploaded successfully',
      data: {
        document: {
          type: docType,
          url: vehicle.documents[docType].url,
          expiryDate: vehicle.documents[docType].expiryDate,
          uploadedAt: vehicle.documents[docType].uploadedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get vehicle documents
 * GET /api/vehicles/:id/documents
 */
const getDocuments = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findById(id).select('documents transporterId');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Check ownership (for transporters)
    if (req.user.userType === 'transporter' && vehicle.transporterId.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not own this vehicle.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Documents retrieved successfully',
      data: {
        documents: vehicle.documents,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get expiring documents (Admin only - placeholder for Phase 7)
 * GET /api/vehicles/documents/expiring
 */
const getExpiringDocuments = async (req, res, next) => {
  try {
    // This will be fully implemented in Phase 7 (Admin Dashboard)
    // For now, return empty array
    return res.status(200).json({
      success: true,
      message: 'Expiring documents retrieved successfully',
      data: {
        documents: [],
        count: 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadDocument,
  getDocuments,
  getExpiringDocuments,
};
