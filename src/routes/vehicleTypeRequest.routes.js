const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { submitRequest, listMine } = require('../controllers/vehicleTypeRequest.controller');

router.use(authenticate);

/**
 * @route   POST /api/vehicle-type-requests
 * @desc    Submit a new vehicle type for admin approval
 * @access  Private (transporter, company-user with manageVehicles)
 */
router.post('/', submitRequest);

/**
 * @route   GET /api/vehicle-type-requests/mine
 * @desc    List caller's vehicle type requests
 * @access  Private (transporter, company-user with manageVehicles)
 */
router.get('/mine', listMine);

module.exports = router;
