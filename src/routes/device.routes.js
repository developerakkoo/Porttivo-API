const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const {
  registerDevice,
  unregisterDevice
} = require('../controllers/device.controller')

router.use(authenticate)

// Register / refresh an FCM device token for the authenticated user.
router.post('/register', registerDevice)

// Remove a token (on logout or refresh).
router.delete('/token', unregisterDevice)

module.exports = router
