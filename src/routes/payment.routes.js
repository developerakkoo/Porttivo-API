const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const {
  getPaymentGatewayOptions,
  initiatePaymentSession,
  getPaymentSessionStatus,
  getPaymentSessionByReference,
  handleCashfreeReturn,
  getTransporterPaymentHistory,
  getAdminPaymentHistory,
  handleGatewayWebhook
} = require('../controllers/payment.controller')

router.get('/gateways', authenticate, getPaymentGatewayOptions)
router.post('/sessions', authenticate, initiatePaymentSession)
router.get('/sessions/:id', authenticate, getPaymentSessionStatus)
router.get('/references/:referenceType/:referenceId', authenticate, getPaymentSessionByReference)

router.get('/cashfree/return', handleCashfreeReturn)
router.post('/:provider/webhook', handleGatewayWebhook)
router.get('/:provider/webhook', handleGatewayWebhook)
router.get('/transporter/history',authenticate, getTransporterPaymentHistory)
router.get('/admin/history', authenticate, getAdminPaymentHistory)

module.exports = router
