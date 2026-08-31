const express = require('express')

const router =
  express.Router()

const {
  authenticate
} = require('../middleware/auth.middleware')

const {
  createTransporterPaymentLink,
  getTransporterPaymentLinkStatus,
  cancelTransporterPaymentLink,
  handleRazorpayPaymentLinkWebhook
} = require(
  '../controllers/razorpayPaymentLink.controller'
)

/*
 * Razorpay webhook
 *
 * IMPORTANT:
 * This route must be reachable without JWT authentication.
 */
router.get( '/razorpay/webhook', handleRazorpayPaymentLinkWebhook )
router.post( '/razorpay/webhook', handleRazorpayPaymentLinkWebhook )
router.use(authenticate) 

/*
 * Transporter A creates payment link.
 */
router.post( '/', createTransporterPaymentLink)

/*
 * Get payment link status.
 */
router.get(
  '/:id',
  getTransporterPaymentLinkStatus
)

/*
 * Cancel payment link.
 */
router.post(
  '/:id/cancel',
  cancelTransporterPaymentLink
)

module.exports = router
