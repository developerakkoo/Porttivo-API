const mongoose = require('mongoose')
const SupportTicket = require('../models/SupportTicket')
const SupportMessage = require('../models/SupportMessage')
const SupportTicketEvent = require('../models/SupportTicketEvent')
const SupportTicketCounter = require('../models/SupportTicketCounter')
const Admin = require('../models/Admin')
const Notification = require('../models/Notification')
const {
  MAX_CHAT_ATTACHMENTS,
  normalizeAttachmentsInput
} = require('../utils/marketplaceChatAttachments')
const {
  buildSupportMessageSocketPayload,
  buildSupportTicketUpdatedPayload
} = require('../utils/supportChatPayload')
const {
  validateCreatePayload,
  buildSubject
} = require('../constants/supportTicketCategories')
const MSG_MAX_LEN = 2000

async function allocateTicketSeq() {
  const doc = await SupportTicketCounter.findOneAndUpdate(
    { _id: 'support_ticket' },
    [{ $set: { seq: { $add: [{ $ifNull: ['$seq', 99999] }, 1] } } }],
    { new: true, upsert: true, updatePipeline: true }
  )
  const seq = doc?.seq
  if (seq == null) throw new Error('Failed to allocate ticket sequence')
  return { ticketSeq: seq, ticketNumber: `SUP-${seq}` }
}

function toTicketPlain(t) {
  if (!t) return null
  const o = t.toObject ? t.toObject() : { ...t }
  o.id = o._id?.toString?.()
  o.transporterId =
    o.transporterId?._id?.toString?.() ?? o.transporterId?.toString?.() ?? o.transporterId
  return o
}

function toMessagePlain(m) {
  if (!m) return null
  const o = m.toObject ? m.toObject() : { ...m }
  o.id=o._id?.toString?.()
  o.ticketId = o.ticketId?.toString?.() ?? o.ticketId
  o.senderId = o.senderId?.toString?.() ?? o.senderId
  return o
}

async function notifyAllActiveAdmins({ type, title, message, data }, io = null) {
  const admins = await Admin.find({ status: 'active' }).select('_id').lean()
  const docs = admins.map(a => ({
    userId: a._id,
    userType: 'ADMIN',
    type,
    title,
    message,
    data: data || {},
    priority: 'high'
  }))
  if (docs.length) {
    await Notification.insertMany(docs)
  }
  if (io && docs.length) {
    io.to('admin:all').emit('admin:notification', {
      type,
      title,
      message,
      ticketId:
        data?.ticketId != null && data.ticketId.toString
          ? data.ticketId.toString()
          : data?.ticketId,
      ticketNumber: data?.ticketNumber
    })
  }
}

async function notifyTransporter(transporterId, { type, title, message, data }) {
  await Notification.create({
    userId: transporterId,
    userType: 'TRANSPORTER',
    type,
    title,
    message,
    data: data || {},
    priority: 'medium'
  })
}

function effectiveMessageType(contentTrim, attachments) {
  if (attachments.length > 0) return 'ATTACHMENT'
  return 'TEXT'
}

function broadcastMessage(io, ticket, transporterId, populatedLean) {
  if (!io) return
  const senderType = populatedLean.senderType
  const payload = buildSupportMessageSocketPayload(
    ticket._id,
    populatedLean,
    senderType
  )
  io.to(`support:${ticket._id}`).emit('support:message:new', payload)
  if (senderType === 'system') {
    io.to(`transporter:${transporterId}`).emit('support:message:new', payload)
    io.to('admin:all').emit('support:message:new', payload)
  } else if (senderType === 'admin') {
    io.to(`transporter:${transporterId}`).emit('support:message:new', payload)
  } else {
    io.to('admin:all').emit('support:message:new', payload)
  }
}

function broadcastTicketUpdated(io, ticketLean, transporterId) {
  if (!io) return
  const payload = buildSupportTicketUpdatedPayload(ticketLean)
  io.to(`support:${ticketLean._id}`).emit('support:ticket:updated', payload)
  io.to(`transporter:${transporterId}`).emit('support:ticket:updated', payload)
  io.to('admin:all').emit('support:ticket:updated', payload)
}

/**
 * @param {import('socket.io').Server | null} io
 */
async function createTicket(io, transporterId, body) {
  const {
    subject: subjRaw,
    priority = 'medium',
    message: initialMessage = '',
    attachments: attachmentsRaw
  } = body || {}

  const { category, categoryDetail } = validateCreatePayload(body)

  let subject = String(subjRaw || '').trim()
  if (!subject) {
    subject = buildSubject(category, categoryDetail)
  }
  if (!subject) {
    const err = new Error('subject is required')
    err.status = 400
    throw err
  }

  const attachments = normalizeAttachmentsInput(attachmentsRaw)
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    const err = new Error(`At most ${MAX_CHAT_ATTACHMENTS} attachments`)
    err.status = 400
    throw err
  }

  const contentTrim = String(initialMessage || '').trim()
  if (!contentTrim && attachments.length === 0) {
    const err = new Error('Provide a first message or attachments')
    err.status = 400
    throw err
  }
  if (contentTrim.length > MSG_MAX_LEN) {
    const err = new Error('Message too long')
    err.status = 400
    throw err
  }

  const { ticketSeq, ticketNumber } = await allocateTicketSeq()

  const ticket = await SupportTicket.create({
    ticketNumber,
    ticketSeq,
    transporterId,
    subject,
    category,
    categoryDetail,
    priority: ['low', 'medium', 'high', 'urgent'].includes(priority)
      ? priority
      : 'medium',
    status: 'open',
    lastMessageAt: new Date(),
    lastMessagePreview:
      contentTrim.slice(0, 120) ||
      (attachments.length ? `[${attachments.length} attachment(s)]` : ''),
    unreadByTransporter: 0,
    unreadByAdmin: 1
  })

  const msgType = effectiveMessageType(
    attachments.length > 0 ? contentTrim : contentTrim,
    attachments
  )
  const message = await SupportMessage.create({
    ticketId: ticket._id,
    senderType: 'transporter',
    senderId: transporterId,
    messageType: msgType,
    content: contentTrim,
    attachments,
    status: 'SENT',
    readAt: null
  })

  await SupportTicketEvent.create({
    ticketId: ticket._id,
    type: 'created',
    actorType: 'transporter',
    actorId: transporterId,
    payload: { subject, category, categoryDetail }
  })

  const populatedMessage = await SupportMessage.findById(message._id).lean()

  await notifyAllActiveAdmins(
    {
      type: 'SUPPORT_TICKET_CREATED',
      title: 'New support ticket',
      message: `${ticketNumber}: ${subject}`,
      data: {
        ticketId: ticket._id.toString(),
        ticketNumber,
        transporterId: transporterId.toString(),
        category
      }
    },
    io
  )

  const freshTicket = await SupportTicket.findById(ticket._id).lean()
  broadcastTicketUpdated(io, freshTicket, transporterId.toString())
  broadcastMessage(io, ticket, transporterId.toString(), {
    ...populatedMessage,
    senderType: 'transporter'
  })

  return { ticket: freshTicket, message: populatedMessage }
}

async function assertTicketAccess(ticketId, { transporterId, adminUserId }) {
  const ticket = await SupportTicket.findById(ticketId)
  if (!ticket) {
    const err = new Error('Ticket not found')
    err.status = 404
    throw err
  }
  if (transporterId) {
    if (ticket.transporterId.toString() !== transporterId.toString()) {
      const err = new Error('Forbidden')
      err.status = 403
      throw err
    }
  } else if (!adminUserId) {
    const err = new Error('Forbidden')
    err.status = 403
    throw err
  }
  return ticket
}

/**
 * Persist a message and broadcast. Caller must verify access.
 * @returns {Promise<{ message: object, ticket: object }>}
 */
async function appendMessage(io, ticket, { senderType, senderId, content, attachmentsRaw }) {
  if (senderType === 'system') {
    const err = new Error('Invalid message')
    err.status = 400
    throw err
  }
  if (!['transporter', 'admin'].includes(senderType)) {
    const err = new Error('Invalid senderType')
    err.status = 400
    throw err
  }
  if (senderType === 'transporter' && ticket.status === 'resolved') {
    const err = new Error(
      'This ticket is resolved. Open a new support ticket to continue.'
    )
    err.status = 400
    throw err
  }

  const attachments = normalizeAttachmentsInput(attachmentsRaw)
  if (attachments.length > MAX_CHAT_ATTACHMENTS) {
    const err = new Error(`At most ${MAX_CHAT_ATTACHMENTS} attachments`)
    err.status = 400
    throw err
  }

  const contentTrim = content != null ? String(content).trim() : ''
  if (!contentTrim && attachments.length === 0) {
    const err = new Error('content or attachments required')
    err.status = 400
    throw err
  }
  if (contentTrim.length > MSG_MAX_LEN) {
    const err = new Error('Message too long')
    err.status = 400
    throw err
  }

  const tId = ticket.transporterId.toString()
  const msgType = effectiveMessageType(contentTrim, attachments)

  if (senderType === 'admin') {
    ticket.unreadByTransporter = (ticket.unreadByTransporter || 0) + 1
  } else {
    ticket.unreadByAdmin = (ticket.unreadByAdmin || 0) + 1
  }

  ticket.lastMessageAt = new Date()
  ticket.lastMessagePreview =
    contentTrim.slice(0, 120) ||
    (attachments.length ? `[${attachments.length} attachment(s)]` : '')

  const message = await SupportMessage.create({
    ticketId: ticket._id,
    senderType,
    senderId,
    messageType: msgType,
    content: contentTrim,
    attachments,
    status: 'SENT',
    readAt: null
  })

  await ticket.save()

  let populatedMessage = await SupportMessage.findById(message._id).lean()
  populatedMessage = {
    ...populatedMessage,
    senderType
  }

  broadcastMessage(io, ticket, tId, populatedMessage)

  if (senderType === 'admin') {
    await notifyTransporter(tId, {
      type: 'SUPPORT_MESSAGE',
      title: `Support: ${ticket.ticketNumber}`,
      message: contentTrim.slice(0, 200) || 'New message from support',
      data: {
        ticketId: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber
      }
    })
  } else {
    await notifyAllActiveAdmins(
      {
        type: 'SUPPORT_MESSAGE',
        title: `Ticket ${ticket.ticketNumber}`,
        message: contentTrim.slice(0, 200) || 'New message from transporter',
        data: {
          ticketId: ticket._id.toString(),
          ticketNumber: ticket.ticketNumber,
          transporterId: tId
        }
      },
      io
    )
  }

  const freshTicket = await SupportTicket.findById(ticket._id).lean()
  broadcastTicketUpdated(io, freshTicket, tId)

  return { message: populatedMessage, ticket: freshTicket }
}

/**
 * Insert an automated thread line (resolve, thanks, etc.). Updates preview and optional unread.
 * @returns {Promise<{ message: object, ticket: object }>}
 */
async function insertSystemMessage(
  io,
  ticketDoc,
  {
    messageType,
    content,
    preview,
    systemMeta,
    incrementTransporterUnread = false,
    incrementAdminUnread = false
  }
) {
  const message = await SupportMessage.create({
    ticketId: ticketDoc._id,
    senderType: 'system',
    messageType,
    content,
    systemMeta,
    attachments: [],
    status: 'READ',
    readAt: new Date()
  })
  if (incrementTransporterUnread) {
    ticketDoc.unreadByTransporter = (ticketDoc.unreadByTransporter || 0) + 1
  }
  if (incrementAdminUnread) {
    ticketDoc.unreadByAdmin = (ticketDoc.unreadByAdmin || 0) + 1
  }
  ticketDoc.lastMessageAt = new Date()
  ticketDoc.lastMessagePreview = (preview != null
    ? String(preview)
    : String(content || '')
  ).slice(0, 120)
  await ticketDoc.save()

  let populatedMessage = await SupportMessage.findById(message._id).lean()
  populatedMessage = { ...populatedMessage, senderType: 'system' }
  const tId = ticketDoc.transporterId.toString()
  broadcastMessage(io, ticketDoc, tId, populatedMessage)
  const freshTicket = await SupportTicket.findById(ticketDoc._id).lean()
  broadcastTicketUpdated(io, freshTicket, tId)
  return { message: populatedMessage, ticket: freshTicket }
}

async function updateTicketStatus(io, ticket, adminId, { status, subject }) {
  const prev = ticket.status
  let statusChanged = false
  if (status) {
    if (!['open', 'pending', 'resolved'].includes(status)) {
      const err = new Error('Invalid status')
      err.status = 400
      throw err
    }
    if (status !== prev) {
      statusChanged = true
      ticket.status = status
    }
  }
  if (subject != null && String(subject).trim()) {
    ticket.subject = String(subject).trim().slice(0, 500)
  }
  await ticket.save()

  if (statusChanged) {
    await SupportTicketEvent.create({
      ticketId: ticket._id,
      type: 'status_changed',
      actorType: 'admin',
      actorId: adminId,
      payload: { from: prev, to: ticket.status }
    })
  }

  const tId = ticket.transporterId.toString()

  if (statusChanged && ticket.status === 'resolved') {
    await notifyTransporter(tId, {
      type: 'SUPPORT_STATUS_CHANGED',
      title: `Ticket ${ticket.ticketNumber} resolved`,
      message:
        'Your support ticket was marked resolved. Please rate your experience in the app.',
      data: {
        ticketId: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
        status: ticket.status
      }
    })
    const ticketReload = await SupportTicket.findById(ticket._id)
    if (ticketReload) {
      const preview = 'Ticket marked resolved'
      const content = `This conversation was marked resolved by support (ticket ${ticketReload.ticketNumber}). You can leave a rating to help us improve.`
      await insertSystemMessage(io, ticketReload, {
        messageType: 'SYSTEM_STATUS',
        content,
        preview,
        systemMeta: {
          kind: 'status_change',
          from: prev,
          to: 'resolved',
          actorAdminId:
            adminId != null && adminId.toString
              ? adminId.toString()
              : String(adminId)
        },
        incrementTransporterUnread: true,
        incrementAdminUnread: false
      })
    }
    return SupportTicket.findById(ticket._id).lean()
  }

  if (statusChanged) {
    await notifyTransporter(tId, {
      type: 'SUPPORT_STATUS_CHANGED',
      title: `Ticket ${ticket.ticketNumber} updated`,
      message: `Status is now ${ticket.status}`,
      data: {
        ticketId: ticket._id.toString(),
        ticketNumber: ticket.ticketNumber,
        status: ticket.status
      }
    })
  }

  const freshTicket = await SupportTicket.findById(ticket._id).lean()
  broadcastTicketUpdated(io, freshTicket, tId)
  return freshTicket
}

/**
 * One-time CSAT for a resolved ticket (transporter scope).
 * @param {import('socket.io').Server | null} io
 */
async function submitTicketRating(io, ticketId, transporterId, { score, comment }) {
  const ticket = await SupportTicket.findById(ticketId)
  if (!ticket) {
    const err = new Error('Ticket not found')
    err.status = 404
    throw err
  }
  if (ticket.transporterId.toString() !== transporterId.toString()) {
    const err = new Error('Forbidden')
    err.status = 403
    throw err
  }
  if (ticket.status !== 'resolved') {
    const err = new Error('You can only rate resolved tickets')
    err.status = 400
    throw err
  }
  if (ticket.ratedAt) {
    const err = new Error('This ticket has already been rated')
    err.status = 409
    throw err
  }
  const s = Number(score)
  if (!Number.isInteger(s) || s < 1 || s > 5) {
    const err = new Error('score must be an integer from 1 to 5')
    err.status = 400
    throw err
  }
  const commentTrim =
    comment != null ? String(comment).trim().slice(0, 500) : ''
  ticket.ratingScore = s
  ticket.ratingComment = commentTrim
  ticket.ratedAt = new Date()
  await ticket.save()

  await SupportTicketEvent.create({
    ticketId: ticket._id,
    type: 'rated',
    actorType: 'transporter',
    actorId: transporterId,
    payload: { score: s, hasComment: !!commentTrim }
  })

  const tReload = await SupportTicket.findById(ticket._id)
  if (tReload) {
    await insertSystemMessage(io, tReload, {
      messageType: 'SYSTEM_RATING_THANKS',
      content: 'Thank you for your feedback.',
      preview: 'Thank you for your feedback',
      systemMeta: { kind: 'rating_thanks' },
      incrementTransporterUnread: false,
      incrementAdminUnread: true
    })
  }

  return SupportTicket.findById(ticket._id).lean()
}

async function markDeliveredForOthers(ticketId, joinedUserIsAdmin) {
  const senderTypeToMark =
    joinedUserIsAdmin === true ? 'transporter' : 'admin'
  await SupportMessage.updateMany(
    {
      ticketId,
      status: 'SENT',
      senderType: senderTypeToMark
    },
    { status: 'DELIVERED' }
  )
}

/** When a party opens the thread, clear their unread badge on the ticket. */
async function clearUnreadForViewer(ticketId, viewerIsAdmin) {
  const patch = viewerIsAdmin
    ? { unreadByAdmin: 0 }
    : { unreadByTransporter: 0 }
  await SupportTicket.findByIdAndUpdate(ticketId, { $set: patch })
  return SupportTicket.findById(ticketId).lean()
}

async function markMessageRead(messageId, reader) {
  const message = await SupportMessage.findById(messageId)
  if (!message) {
    const err = new Error('Message not found')
    err.status = 404
    throw err
  }

  const ticket = await SupportTicket.findById(message.ticketId)
  if (!ticket) {
    const err = new Error('Ticket not found')
    err.status = 404
    throw err
  }

  const tId = ticket.transporterId.toString()
  const isAdmin = reader.userType === 'admin'
  const scopeTransporter = reader.transporterScopeId

  if (isAdmin) {
    if (message.senderType !== 'transporter') {
      const err = new Error('Only transporter messages can be marked read by admin')
      err.status = 400
      throw err
    }
  } else {
    if (!scopeTransporter || tId !== scopeTransporter) {
      const err = new Error('Forbidden')
      err.status = 403
      throw err
    }
    if (message.senderType === 'system') {
      const err = new Error('System messages cannot be marked read')
      err.status = 400
      throw err
    }
    if (message.senderType !== 'admin') {
      const err = new Error('Only admin messages can be marked read by transporter')
      err.status = 400
      throw err
    }
  }

  if (message.status !== 'READ') {
    message.status = 'READ'
    message.readAt = new Date()
    await message.save()
  }

  return { message, ticket }
}

async function listMessages(ticketId, { limit = 40, before }) {
  const q = { ticketId: new mongoose.Types.ObjectId(ticketId) }
  if (before && mongoose.Types.ObjectId.isValid(before)) {
    q._id = { $lt: new mongoose.Types.ObjectId(before) }
  }
  const items = await SupportMessage.find(q)
    .sort({ _id: -1 })
    .limit(Math.min(Number(limit) || 40, 100))
    .lean()

  items.reverse()
  return items
}

module.exports = {
  allocateTicketSeq,
  createTicket,
  assertTicketAccess,
  appendMessage,
  insertSystemMessage,
  updateTicketStatus,
  submitTicketRating,
  markDeliveredForOthers,
  clearUnreadForViewer,
  markMessageRead,
  listMessages,
  broadcastMessage,
  broadcastTicketUpdated,
  notifyAllActiveAdmins,
  toTicketPlain,
  toMessagePlain,
  MSG_MAX_LEN,
  MAX_CHAT_ATTACHMENTS,
  normalizeAttachmentsInput,
}
