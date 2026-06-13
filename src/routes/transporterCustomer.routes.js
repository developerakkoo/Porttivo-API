const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  listTransporterCustomers,
  createTransporterCustomer,
} = require('../controllers/transporterCustomer.controller');

router.use(authenticate);

router.get('/', listTransporterCustomers);
router.post('/', createTransporterCustomer);

module.exports = router;
