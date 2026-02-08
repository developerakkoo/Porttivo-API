const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getFuelCards,
  createFuelCard,
  assignFuelCard,
  getAssignedFuelCard,
  getFuelCardTransactions,
} = require('../controllers/fuelCard.controller');

// All routes require authentication
router.use(authenticate);

// Fuel card routes
router.get('/', getFuelCards);
router.post('/', createFuelCard); // Admin only
router.put('/:id/assign', assignFuelCard); // Transporter only
router.get('/assigned', getAssignedFuelCard); // Driver only
router.get('/:id/transactions', getFuelCardTransactions);

module.exports = router;
