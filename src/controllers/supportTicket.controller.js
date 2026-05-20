const mongoose = require('mongoose')
const SupportTicket = require('../models/SupportTicket')
const SupportTicketEvent = require('../models/SupportTicketEvent')
const { getIO } = require('../services/socket.service')
const { getTransporterActorId } = require('../utils/transporterActor')
const supportTicketService = require('../services/supportTicket.service')

function safeIO() {
  try {
    return getIO()
  } catch {
    return null
  }
}

exports.createTicketTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    if (!transporterId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    const io = safeIO()
    const { ticket, message } = await supportTicketService.createTicket(
      io,
      transporterId,
      req.body
    )
    return res.status(201).json({
      success: true,
      data: { ticket, message }
    })
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
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const skip = (page - 1) * limit

    const filter = { transporterId }
    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
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
  } catch (err) {
    next(err)
  }
}

exports.getTicketTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    const ticket = await supportTicketService.assertTicketAccess(req.params.id, {
      transporterId
    })
    return res.json({ success: true, data: { ticket: ticket.toObject() } })
  } catch (err) {
    if (err.status === 404)
      return res.status(404).json({ success: false, message: err.message })
    if (err.status === 403)
      return res.status(403).json({ success: false, message: err.message })
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
    if (err.status === 404)
      return res.status(404).json({ success: false, message: err.message })
    if (err.status === 403)
      return res.status(403).json({ success: false, message: err.message })
    next(err)
  }
}

exports.postMessageTransporter = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    if (!transporterId) {
      return res.status(403).json({ success: false, message: 'Forbidden' })
    }
    const ticket = await supportTicketService.assertTicketAccess(req.params.id, {
      transporterId
    })
    const io = safeIO()
    const { message, ticket: fresh } = await supportTicketService.appendMessage(
      io,
      ticket,
      {
        senderType: 'transporter',
        senderId: transporterId,
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
    const tId = ticket.transporterId.toString()
    const freshTicket = await SupportTicket.findById(ticket._id).lean()
    supportTicketService.broadcastTicketUpdated(io, freshTicket, tId)
    return res.json({ success: true, data: { ticket: freshTicket } })
  } catch (err) {
    if (err.status === 404)
      return res.status(404).json({ success: false, message: err.message })
    if (err.status === 403)
      return res.status(403).json({ success: false, message: err.message })
    next(err)
  }
}

exports.markMessageReadTransporter = async (req, res, next) => {
  try {
    const reader = {
      userType: 'transporter',
      transporterScopeId: getTransporterActorId(req.user)
    }
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

exports.listTicketsAdmin = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20))
    const skip = (page - 1) * limit
    const filter = {}
    if (req.query.status) filter.status = req.query.status
    if (req.query.transporterId && mongoose.Types.ObjectId.isValid(req.query.transporterId)) {
      filter.transporterId = req.query.transporterId
    }

    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
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
