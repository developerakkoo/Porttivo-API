const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const {
  initiateMarketplaceTripPayuPayment,
  handlePayuWebhook,
  getMarketplaceTripPaymentStatus
} = require('../controllers/marketplacePayment.controller')

router.post('/payu/webhook', handlePayuWebhook)
router.get('/payu/webhook', handlePayuWebhook)

router.use(authenticate)

router.post('/trips/:tripId/payu/initiate', initiateMarketplaceTripPayuPayment)
router.get('/trips/:tripId/payu/status', getMarketplaceTripPaymentStatus)

module.exports = router
