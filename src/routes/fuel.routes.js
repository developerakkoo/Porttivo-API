const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  generateQR,
  validateQR,
  scanQR,
  confirmTransaction,
  cancelTransaction,
  submitTransaction,
  getTransactions,
  getTransactionById,
  uploadReceipt,
  getReceipt,
} = require('../controllers/fuelTransaction.controller');
const {
  getFraudAlerts,
  getFraudAlertById,
  flagTransaction,
  resolveFraudAlert,
  getFraudStats,
} = require('../controllers/fraud.controller');
const { uploadReceipt: uploadReceiptMiddleware, handleMulterError } = require('../middleware/upload.middleware');

// All routes require authentication
router.use(authenticate);

// QR code routes
router.post('/generate-qr', generateQR); // Driver only
router.post('/validate-qr', validateQR);
router.post('/scan-qr', scanQR); // Driver only

// Transaction routes
router.post('/confirm', confirmTransaction); // Driver only
router.post('/cancel', cancelTransaction); // Driver only
router.post('/submit', submitTransaction); // Pump staff only
router.get('/transactions', getTransactions);
router.get('/transactions/:id', getTransactionById);
router.post('/transactions/:id/receipt', uploadReceiptMiddleware, handleMulterError, uploadReceipt); // Driver only
router.get('/receipt/:id', getReceipt);

// Fraud routes (Admin only)
router.get('/fraud-alerts', getFraudAlerts);
router.get('/fraud-alerts/:id', getFraudAlertById);
router.post('/transactions/:id/flag', flagTransaction);
router.put('/fraud-alerts/:id/resolve', resolveFraudAlert);
router.get('/fraud-stats', getFraudStats);

module.exports = router;
