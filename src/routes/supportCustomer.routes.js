const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const ctrl = require('../controllers/supportTicket.controller')

router.use(authenticate)
router.use((req, res, next) => {
  if (req.user.userType !== 'customer') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Customer account required.'
    })
  }
  next()
})

router.get('/categories', ctrl.getSupportCategoriesCustomer)
router.post('/tickets', ctrl.createTicketCustomer)
router.get('/tickets', ctrl.listTicketsCustomer)
router.get('/tickets/:id', ctrl.getTicketCustomer)
router.get('/tickets/:id/messages', ctrl.getMessagesCustomer)
router.post('/tickets/:id/messages', ctrl.postMessageCustomer)
router.post('/tickets/:id/rating', ctrl.postTicketRatingCustomer)
router.patch('/tickets/:id', ctrl.patchTicketCustomer)
router.put('/messages/:messageId/read', ctrl.markMessageReadCustomer)

module.exports = router
