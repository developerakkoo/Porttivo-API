const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const {
  cancelPayout,
  createBeneficiary,
  createPayout,
  getAdminPayoutSummary,
  getBeneficiary,
  getPayoutByPayment,
  getPayoutStatus,
  handleCashfreeWebhook,
  listPayouts,
  retryPayout,
  runRetryCronNow,
  removeBeneficiary,
  triggerAutomaticPayout
} = require('../controllers/payout.controller')

router.post('/cashfree/webhook', handleCashfreeWebhook)
router.get('/cashfree/webhook', handleCashfreeWebhook)

router.use(authenticate)

router.post('/beneficiary', createBeneficiary)
router.get('/beneficiary', getBeneficiary)
router.delete('/beneficiary', removeBeneficiary)
router.post('/', createPayout)
router.get('/', listPayouts)
router.get('/admin/summary', getAdminPayoutSummary)
router.post('/admin/retry-cron', runRetryCronNow)
router.get('/payments/:paymentId', getPayoutByPayment)
router.post('/payments/:paymentId/start', triggerAutomaticPayout)
router.post('/:id/retry', retryPayout)
router.post('/:id/cancel', cancelPayout)
router.get('/:id', getPayoutStatus)

module.exports = router
