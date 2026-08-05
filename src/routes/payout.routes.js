const express = require('express')
const router = express.Router()
const { authenticate, authorizeRoles } = require('../middleware/auth.middleware')
const {
  cancelPayout,
  createBeneficiary,
  createPayout,
  getAdminPayoutSummary,
  getBeneficiary,
  getPayoutByPayment,
  getPayoutStatus,
  handleCashfreeWebhook,
  handleRazorpayWebhook,
  createRazorpayContact,
  getRazorpayContact,
  listRazorpayContacts,
  createRazorpayFundAccount,
  listRazorpayFundAccounts,
  createRazorpayPayout,
  listRazorpayPayouts,
  getRazorpayPayout,
  listRazorpayTransactions,
  getRazorpayTransaction,
  listPayouts,
  retryPayout,
  runRetryCronNow,
  removeBeneficiary,
  triggerAutomaticPayout
} = require('../controllers/payout.controller')

router.post('/cashfree/webhook', handleCashfreeWebhook)
router.get('/cashfree/webhook', handleCashfreeWebhook)
router.post('/razorpay/webhook', handleRazorpayWebhook)
router.get('/razorpay/webhook', handleRazorpayWebhook)

router.use(authenticate)

// Allow admin, transporter and driver to access Razorpay proxy endpoints
router.use('/razorpay', authorizeRoles(['admin', 'transporter', 'driver']))

router.post('/beneficiary', createBeneficiary)
router.get('/beneficiary', getBeneficiary)
router.delete('/beneficiary', removeBeneficiary)
// Razorpay proxy endpoints
router.post('/razorpay/contacts', createRazorpayContact)
router.get('/razorpay/contacts/:id', getRazorpayContact)
router.get('/razorpay/contacts', listRazorpayContacts)
router.post('/razorpay/fund_accounts', createRazorpayFundAccount)
router.get('/razorpay/fund_accounts', listRazorpayFundAccounts)
router.post('/razorpay/payouts', createRazorpayPayout)
router.get('/razorpay/payouts', listRazorpayPayouts)
router.get('/razorpay/payouts/:id', getRazorpayPayout)
router.get('/razorpay/transactions', listRazorpayTransactions)
router.get('/razorpay/transactions/:id', getRazorpayTransaction)
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
