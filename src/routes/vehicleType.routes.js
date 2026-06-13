const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const { listPublicVehicleTypes } = require('../controllers/vehicleType.controller');

router.use(authenticate);

/**
 * @route   GET /api/vehicle-types
 * @desc    List active vehicle types for transporter / company users
 * @access  Private (transporter, company-user with manageVehicles, admin)
 */
router.get('/', listPublicVehicleTypes);

module.exports = router;
