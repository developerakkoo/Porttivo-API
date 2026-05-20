/**
 * Socket/API payload for support ticket messages (Flutter-friendly string ids).
 */
function buildSupportMessageSocketPayload(ticketId, messageLean, senderType) {
  const tid =
    ticketId != null && ticketId.toString ? ticketId.toString() : String(ticketId)

  const m = messageLean
    ? {
        ...messageLean,
        ticketId:
          messageLean.ticketId != null ? messageLean.ticketId.toString() : tid,
        senderId:
          messageLean.senderId != null && messageLean.senderId.toString
            ? messageLean.senderId.toString()
            : messageLean.senderId,
      }
    : null

  return {
    ticketId: tid,
    message: m,
    senderType,
    timestamp: new Date(),
  }
}

/**
 * Payload when ticket metadata changes (status, unread counts, preview).
 */
function buildSupportTicketUpdatedPayload(ticketLean, extra = {}) {
  const t = ticketLean
  if (!t) return { ...extra }

  return {
    ticket: {
      _id: t._id?.toString?.() ?? String(t._id),
      id: t._id?.toString?.() ?? String(t._id),
      ticketNumber: t.ticketNumber,
      ticketSeq: t.ticketSeq,
      transporterId:
        t.transporterId != null
          ? (t.transporterId._id ?? t.transporterId).toString()
          : undefined,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      lastMessageAt: t.lastMessageAt,
      lastMessagePreview: t.lastMessagePreview,
      unreadByTransporter: t.unreadByTransporter,
      unreadByAdmin: t.unreadByAdmin,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    },
    ...extra,
  }
}

module.exports = { buildSupportMessageSocketPayload, buildSupportTicketUpdatedPayload }
