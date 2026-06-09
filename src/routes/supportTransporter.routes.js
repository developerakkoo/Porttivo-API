const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { getTransporterActorId } = require('../utils/transporterActor')
const ctrl = require('../controllers/supportTicket.controller')

router.use(authenticate)
router.use((req, res, next) => {
  const ut = req.user.userType
  if (ut !== 'transporter' && ut !== 'company-user') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Transporter or company user required.'
    })
  }
  if (!getTransporterActorId(req.user)) {
    return res.status(403).json({ success: false, message: 'No transporter scope' })
  }
  next()
})

router.get('/categories', ctrl.getSupportCategoriesTransporter)
router.post('/tickets', ctrl.createTicketTransporter)
router.get('/tickets', ctrl.listTicketsTransporter)
router.get('/tickets/:id', ctrl.getTicketTransporter)
router.get('/tickets/:id/messages', ctrl.getMessagesTransporter)
router.post('/tickets/:id/messages', ctrl.postMessageTransporter)
router.post('/tickets/:id/rating', ctrl.postTicketRatingTransporter)
router.patch('/tickets/:id', ctrl.patchTicketTransporter)
router.put('/messages/:messageId/read', ctrl.markMessageReadTransporter)

module.exports = router
