const Trip = require('../models/Trip');
const path = require('path');

/**
 * Upload POD
 * POST /api/trips/:id/pod
 */
const uploadPOD = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userType = req.user.userType;

    // Find trip
    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access - drivers can upload POD for their assigned trips
    if (userType === 'driver') {
      if (!trip.driverId || trip.driverId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. This trip is not assigned to you.',
        });
      }
    } else if (userType === 'transporter') {
      // Transporters can also upload POD for their trips
      if (trip.transporterId.toString() !== userId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to upload POD for this trip.',
        });
      }
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only drivers and transporters can upload POD.',
      });
    }

    // Validate trip status - POD can be uploaded for COMPLETED trips
    if (trip.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        message: `POD can only be uploaded for COMPLETED trips. Current status: ${trip.status}`,
      });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'POD photo is required',
      });
    }

    // Get photo URL
    const photoUrl = `/uploads/pod/${req.file.filename}`;

    // Update trip POD
    trip.POD = {
      photo: photoUrl,
      uploadedAt: new Date(),
      uploadedBy: userType === 'driver' ? userId : null,
      approvedAt: null,
      approvedBy: null,
    };

    // Update trip status to POD_PENDING
    trip.status = 'POD_PENDING';
    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    res.json({
      success: true,
      message: 'POD uploaded successfully',
      data: trip,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Approve POD
 * PUT /api/trips/:id/pod/approve
 */
const approvePOD = async (req, res, next) => {
  try {
    // Only transporters can approve POD
    if (req.user.userType !== 'transporter') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters can approve POD.',
      });
    }

    const { id } = req.params;
    const transporterId = req.user.id;

    // Find trip
    const trip = await Trip.findById(id);
    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found',
      });
    }

    // Check access
    if (trip.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to approve POD for this trip.',
      });
    }

    // Validate trip status
    if (trip.status !== 'POD_PENDING') {
      return res.status(400).json({
        success: false,
        message: `POD can only be approved when status is POD_PENDING. Current status: ${trip.status}`,
      });
    }

    // Check if POD exists
    if (!trip.POD || !trip.POD.photo) {
      return res.status(400).json({
        success: false,
        message: 'POD has not been uploaded yet',
      });
    }

    // Update POD approval
    trip.POD.approvedAt = new Date();
    trip.POD.approvedBy = transporterId;

    // Update trip status to COMPLETED
    trip.status = 'COMPLETED';
    await trip.save();

    // Populate references
    await trip.populate('vehicleId', 'vehicleNumber trailerType');
    await trip.populate('driverId', 'name mobile');
    await trip.populate('transporterId', 'name company');

    res.json({
      success: true,
      message: 'POD approved successfully',
      data: trip,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  uploadPOD,
  approvePOD,
};
