const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const {
  initiateMarketplaceTripRazorpayPayment,
  handleMarketplaceRazorpayWebhook,
  getMarketplaceTripPaymentStatus
} = require('../controllers/marketplacePayment.controller')

router.post('/razorpay/webhook', handleMarketplaceRazorpayWebhook)
router.get('/razorpay/webhook', handleMarketplaceRazorpayWebhook)

router.use(authenticate)

router.post('/trips/:tripId/razorpay/initiate', initiateMarketplaceTripRazorpayPayment)
router.get('/trips/:tripId/razorpay/status', getMarketplaceTripPaymentStatus)

module.exports = router
