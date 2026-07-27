const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const {
  createRequirement,
  getMyRequirements,
  getIncomingRequirements,
  getRequirementById,
  cancelRequirement
} = require('../controllers/requirement.controller')
const {
  submitQuote,
  getQuotesForRequirement
} = require('../controllers/quote.controller')

router.use(authenticate)

// Requester: post a new inquiry
router.post('/', createRequirement)

// Requester: my posted inquiries
router.get('/mine', getMyRequirements)

// Transporter: inquiries matching my active listings
router.get('/incoming', getIncomingRequirements)

// Details (requester or transporter)
router.get('/:id', getRequirementById)

// Requester: cancel an OPEN inquiry
router.patch('/:id/cancel', cancelRequirement)

// Quotes nested under a requirement
router.post('/:id/quotes', submitQuote)
router.get('/:id/quotes', getQuotesForRequirement)

module.exports = router
