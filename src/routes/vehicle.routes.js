const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getVehicles,
  createVehicle,
  getVehicleById,
  updateVehicle,
  deleteVehicle,
  getVehicleTrips,
} = require('../controllers/vehicle.controller');
const {
  uploadDocument,
  getDocuments,
  getExpiringDocuments,
} = require('../controllers/vehicleDocument.controller');
const { getAvailability } = require('../controllers/vehicleAvailability.controller');

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
