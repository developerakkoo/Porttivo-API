const mongoose = require('mongoose')
const SupportTicket = require('../models/SupportTicket')
const SupportTicketEvent = require('../models/SupportTicketEvent')
const { getIO } = require('../services/socket.service')
const { getTransporterActorId } = require('../utils/transporterActor')
const supportTicketService = require('../services/supportTicket.service')
const {
  buildCategoryFilter,
  getCategoriesMetadata
} = require('../constants/supportTicketCategories')

function safeIO() {
  try {
    return getIO()
  } catch {
    return null
  }
}

function getCustomerActorId(user) {
  if (!user || user.userType !== 'customer') return null
  return user.id?.toString?.() ?? String(user.id)
}

function normalizePage(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 20))
  return { page, limit, skip: (page - 1) * limit }
}

function addRequesterFilter(filter, { requesterType, requesterId }) {
  if (requesterType) {
    filter.requesterType = requesterType
  }
  if (requesterId) {
    filter.requesterId = requesterId
  }
}

async function listTickets(req, res, filter) {
  const { page, limit, skip } = normalizePage(req.query)
  const [tickets, total] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('requesterId', 'name mobile company email')
      .populate('transporterId', 'name mobile company')
      .lean(),
    SupportTicket.countDocuments(filter)
  ])

  return res.json({
    success: true,
    data: {
      tickets,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    }
  })
}

async function getTicketById(ticketId, access) {
  const ticket = await supportTicketService.assertTicketAccess(ticketId, access)
  return SupportTicket.findById(ticket._id)
    .populate('requesterId', 'name mobile company email')
    .populate('transporterId', 'name mobile company')
    .lean()
}

async function sendSupportMessage(req, res, next, senderType, senderId, access) {
  try {
    if (!senderId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }

    const ticket = await supportTicketService.assertTicketAccess(req.params.id, access)
    const io = safeIO()
    const { message, ticket: fresh } = await supportTicketService.appendMessage(
      io,
      ticket,
      {
        senderType,
        senderId,
        content: req.body.content,
        attachmentsRaw: req.body.attachments
      }
    )

    return res.status(201).json({
      success: true,
      data: { message, ticket: fresh }
    })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

async function markMessageReadForRequester(req, res, next, reader) {
  try {
    const { message } = await supportTicketService.markMessageRead(
      req.params.messageId,
      reader
    )
    const io = safeIO()
    io?.to(`support:${message.ticketId}`).emit('support:message:read', {
      ticketId: message.ticketId.toString(),
      messageId: message._id.toString()
    })
    return res.json({ success: true, data: { message } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.getSupportCategories = async (req, res, next) => {
  try {
    return res.json({
      success: true,
      data: { categories: getCategoriesMetadata() }
    })
  } catch (err) {
    next(err)
  }
}

exports.getSupportCategoriesAdmin = exports.getSupportCategories
exports.getSupportCategoriesTransporter = exports.getSupportCategories
exports.getSupportCategoriesCustomer = exports.getSupportCategories

exports.createTicketTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    if (!transporterId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    const io = safeIO()
    const { ticket, message } = await supportTicketService.createTicketForRequester(
      io,
      supportTicketService.getRequesterInfoFromUser(req.user),
      req.body
    )
    return res.status(201).json({ success: true, data: { ticket, message } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.createTicketCustomer = async (req, res, next) => {
  try {
    const customerId = getCustomerActorId(req.user)
    if (!customerId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    const io = safeIO()
    const { ticket, message } = await supportTicketService.createTicketForRequester(
      io,
      {
        requesterType: 'customer',
        requesterModel: 'Customer',
        requesterId: customerId
      },
      req.body
    )
    return res.status(201).json({ success: true, data: { ticket, message } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.listTicketsTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    if (!transporterId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    return await listTickets(req, res, {
      requesterType: 'transporter',
      requesterId: transporterId
    })
  } catch (err) {
    next(err)
  }
}

exports.listTicketsCustomer = async (req, res, next) => {
  try {
    const customerId = getCustomerActorId(req.user)
    if (!customerId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    return await listTickets(req, res, {
      requesterType: 'customer',
      requesterId: customerId
    })
  } catch (err) {
    next(err)
  }
}

exports.getTicketTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    const ticket = await getTicketById(req.params.id, {
      transporterId
    })
    return res.json({ success: true, data: { ticket } })
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message })
    }
    if (err.status === 403) {
      return res.status(403).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.getTicketCustomer = async (req, res, next) => {
  try {
    const customerId = getCustomerActorId(req.user)
    const ticket = await getTicketById(req.params.id, {
      customerId
    })
    return res.json({ success: true, data: { ticket } })
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message })
    }
    if (err.status === 403) {
      return res.status(403).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.getMessagesTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    await supportTicketService.assertTicketAccess(req.params.id, { transporterId })
    const items = await supportTicketService.listMessages(req.params.id, {
      limit: req.query.limit,
      before: req.query.before
    })
    return res.json({ success: true, data: { messages: items } })
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message })
    }
    if (err.status === 403) {
      return res.status(403).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.getMessagesCustomer = async (req, res, next) => {
  try {
    const customerId = getCustomerActorId(req.user)
    await supportTicketService.assertTicketAccess(req.params.id, { customerId })
    const items = await supportTicketService.listMessages(req.params.id, {
      limit: req.query.limit,
      before: req.query.before
    })
    return res.json({ success: true, data: { messages: items } })
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message })
    }
    if (err.status === 403) {
      return res.status(403).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.postMessageTransporter = async (req, res, next) => {
  const transporterId = getTransporterActorId(req.user)
  return sendSupportMessage(
    req,
    res,
    next,
    'transporter',
    transporterId,
    { transporterId }
  )
}

exports.postMessageCustomer = async (req, res, next) => {
  const customerId = getCustomerActorId(req.user)
  return sendSupportMessage(req, res, next, 'customer', customerId, {
    customerId
  })
}

exports.postTicketRatingTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    if (!transporterId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    await supportTicketService.assertTicketAccess(req.params.id, {
      transporterId
    })
    const io = safeIO()
    const ticket = await supportTicketService.submitTicketRating(
      io,
      req.params.id,
      transporterId,
      { score: req.body.score, comment: req.body.comment }
    )
    return res.json({ success: true, data: { ticket } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.postTicketRatingCustomer = async (req, res, next) => {
  try {
    const customerId = getCustomerActorId(req.user)
    if (!customerId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    await supportTicketService.assertTicketAccess(req.params.id, {
      customerId
    })
    const io = safeIO()
    const ticket = await supportTicketService.submitTicketRating(
      io,
      req.params.id,
      customerId,
      { score: req.body.score, comment: req.body.comment }
    )
    return res.json({ success: true, data: { ticket } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.patchTicketTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    const ticket = await supportTicketService.assertTicketAccess(req.params.id, {
      transporterId
    })
    if (req.body.subject != null && String(req.body.subject).trim()) {
      ticket.subject = String(req.body.subject).trim().slice(0, 500)
      await ticket.save()
    }
    const io = safeIO()
    const freshTicket = await SupportTicket.findById(ticket._id).lean()
    supportTicketService.broadcastTicketUpdated(io, freshTicket)
    return res.json({ success: true, data: { ticket: freshTicket } })
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message })
    }
    if (err.status === 403) {
      return res.status(403).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.patchTicketCustomer = async (req, res, next) => {
  try {
    const customerId = getCustomerActorId(req.user)
    const ticket = await supportTicketService.assertTicketAccess(req.params.id, {
      customerId
    })
    if (req.body.subject != null && String(req.body.subject).trim()) {
      ticket.subject = String(req.body.subject).trim().slice(0, 500)
      await ticket.save()
    }
    const io = safeIO()
    const freshTicket = await SupportTicket.findById(ticket._id).lean()
    supportTicketService.broadcastTicketUpdated(io, freshTicket)
    return res.json({ success: true, data: { ticket: freshTicket } })
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ success: false, message: err.message })
    }
    if (err.status === 403) {
      return res.status(403).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.markMessageReadTransporter = async (req, res, next) => {
  return markMessageReadForRequester(req, res, next, {
    userType: 'transporter',
    transporterScopeId: getTransporterActorId(req.user)
  })
}

exports.markMessageReadCustomer = async (req, res, next) => {
  return markMessageReadForRequester(req, res, next, {
    userType: 'customer',
    customerScopeId: getCustomerActorId(req.user)
  })
}

exports.listTicketsAdmin = async (req, res, next) => {
  try {
    const filter = {}
    if (req.query.status) filter.status = req.query.status
    if (req.query.requesterType && ['transporter', 'customer'].includes(req.query.requesterType)) {
      filter.requesterType = req.query.requesterType
    }
    if (req.query.requesterId && mongoose.Types.ObjectId.isValid(req.query.requesterId)) {
      addRequesterFilter(filter, {
        requesterType: req.query.requesterType || undefined,
        requesterId: req.query.requesterId
      })
    } else if (req.query.transporterId && mongoose.Types.ObjectId.isValid(req.query.transporterId)) {
      filter.$or = [
        { transporterId: req.query.transporterId },
        {
          requesterType: 'transporter',
          requesterId: req.query.transporterId
        }
      ]
    }
    const categoryFilter = buildCategoryFilter(req.query)
    if (categoryFilter) {
      Object.assign(filter, categoryFilter)
    }

    return await listTickets(req, res, filter)
  } catch (err) {
    next(err)
  }
}

exports.getTicketAdmin = async (req, res, next) => {
  try {
    await supportTicketService.assertTicketAccess(req.params.id, {
      adminUserId: req.user.id
    })
    const ticket = await SupportTicket.findById(req.params.id)
      .populate('requesterId', 'name mobile company email')
      .populate('transporterId', 'name mobile company')
      .lean()
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' })
    }
    return res.json({ success: true, data: { ticket } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.getMessagesAdmin = async (req, res, next) => {
  try {
    await supportTicketService.assertTicketAccess(req.params.id, {
      adminUserId: req.user.id
    })
    const items = await supportTicketService.listMessages(req.params.id, {
      limit: req.query.limit,
      before: req.query.before
    })
    return res.json({ success: true, data: { messages: items } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.postMessageAdmin = async (req, res, next) => {
  try {
    const ticket = await supportTicketService.assertTicketAccess(req.params.id, {
      adminUserId: req.user.id
    })
    const io = safeIO()
    const { message, ticket: fresh } = await supportTicketService.appendMessage(
      io,
      ticket,
      {
        senderType: 'admin',
        senderId: req.user.id,
        content: req.body.content,
        attachmentsRaw: req.body.attachments
      }
    )
    return res.status(201).json({
      success: true,
      data: { message, ticket: fresh }
    })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.patchTicketAdmin = async (req, res, next) => {
  try {
    const ticket = await supportTicketService.assertTicketAccess(req.params.id, {
      adminUserId: req.user.id
    })
    const io = safeIO()
    const fresh = await supportTicketService.updateTicketStatus(
      io,
      ticket,
      req.user.id,
      { status: req.body.status, subject: req.body.subject }
    )
    return res.json({ success: true, data: { ticket: fresh } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.markMessageReadAdmin = async (req, res, next) => {
  try {
    const reader = { userType: 'admin', transporterScopeId: null }
    const { message } = await supportTicketService.markMessageRead(
      req.params.messageId,
      reader
    )
    const io = safeIO()
    io?.to(`support:${message.ticketId}`).emit('support:message:read', {
      ticketId: message.ticketId.toString(),
      messageId: message._id.toString()
    })
    return res.json({ success: true, data: { message } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}

exports.getTicketEventsAdmin = async (req, res, next) => {
  try {
    await supportTicketService.assertTicketAccess(req.params.id, {
      adminUserId: req.user.id
    })
    const events = await SupportTicketEvent.find({ ticketId: req.params.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
    return res.json({ success: true, data: { events } })
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ success: false, message: err.message })
    }
    next(err)
  }
}
