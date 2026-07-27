const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const {
  selectQuote,
  counterQuote,
  withdrawQuote
} = require('../controllers/quote.controller')
const {
  sendQuoteMessage,
  getQuoteConversation
} = require('../controllers/transporterMessage.controller')

router.use(authenticate)

// Requester: award this quote
router.put('/:id/select', selectQuote)

// Requester: counter-offer on this quote
router.put('/:id/counter', counterQuote)

// Quote-scoped chat ("Chat with Requester")
router.post('/:quoteId/messages', sendQuoteMessage)
router.get('/:quoteId/messages', getQuoteConversation)

// Transporter: withdraw own quote
router.delete('/:id', withdrawQuote)

module.exports = router
