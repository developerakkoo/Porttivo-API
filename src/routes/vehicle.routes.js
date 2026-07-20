const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getVehicles,
  createVehicle,
  bulkImportVehicles,
  getVehicleById,
  updateVehicle,
  deleteVehicle,
  getVehicleTrips,
  verifyVehicleNumber,
  verifyRechargeKitVehicleNumber,
} = require('../controllers/vehicle.controller');
const {
  uploadDocument,
  getDocuments,
  getExpiringDocuments,
} = require('../controllers/vehicleDocument.controller');
const { getAvailability } = require('../controllers/vehicleAvailability.controller');
const { uploadSpreadsheet, handleMulterError } = require('../middleware/upload.middleware');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/vehicles
 * @desc    Get all vehicles for authenticated transporter
 * @access  Private (Transporter only)
 */
router.get('/', getVehicles);

/**
 * @route   POST /api/vehicles
 * @desc    Create new vehicle
 * @access  Private (Transporter only)
 */
router.post('/', createVehicle);

/**
 * @route   POST /api/vehicles/verify
 * @desc    Verify a vehicle number using SurePass
 * @access  Private
 */
router.post('/verify', verifyVehicleNumber);


router.post('/rechargekitverify', verifyRechargeKitVehicleNumber);

/**
 * @route   POST /api/vehicles/bulk-import
 * @desc    Bulk import fleet (vehicles + drivers) from an xlsx/csv file
 * @access  Private (Transporter only)
 */
router.post('/bulk-import', uploadSpreadsheet, handleMulterError, bulkImportVehicles);

/**
 * @route   GET /api/vehicles/:id
 * @desc    Get vehicle by ID
 * @access  Private
 */
router.get('/:id', getVehicleById);

/**
 * @route   PUT /api/vehicles/:id
 * @desc    Update vehicle
 * @access  Private (Transporter only)
 */
router.put('/:id', updateVehicle);

/**
 * @route   DELETE /api/vehicles/:id
 * @desc    Delete vehicle (only if no trip history)
 * @access  Private (Transporter only)
 */
router.delete('/:id', deleteVehicle);

/**
 * @route   GET /api/vehicles/:id/trips
 * @desc    Get vehicle trip history
 * @access  Private
 */
router.get('/:id/trips', getVehicleTrips);

/**
 * @route   GET /api/vehicles/:id/availability
 * @desc    Get vehicle availability state
 * @access  Private
 */
router.get('/:id/availability', getAvailability);

/**
 * @route   POST /api/vehicles/:id/documents
 * @desc    Upload vehicle document
 * @access  Private (Transporter only)
 */
router.post('/:id/documents', uploadDocument);

/**
 * @route   GET /api/vehicles/:id/documents
 * @desc    Get vehicle documents
 * @access  Private
 */
router.get('/:id/documents', getDocuments);

/**
 * @route   GET /api/vehicles/documents/expiring
 * @desc    Get expiring documents (Admin - Phase 7)
 * @access  Private (Admin only - placeholder)
 */
router.get('/documents/expiring', getExpiringDocuments);

module.exports = router;
