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

  const requesterId =
    t.requesterId != null
      ? (t.requesterId._id ?? t.requesterId).toString()
      : t.transporterId != null
        ? (t.transporterId._id ?? t.transporterId).toString()
        : undefined

  return {
    ticket: {
      _id: t._id?.toString?.() ?? String(t._id),
      id: t._id?.toString?.() ?? String(t._id),
      ticketNumber: t.ticketNumber,
      ticketSeq: t.ticketSeq,
      requesterType: t.requesterType || 'transporter',
      requesterId,
      transporterId:
        t.transporterId != null
          ? (t.transporterId._id ?? t.transporterId).toString()
          : undefined,
      subject: t.subject,
      category: t.category,
      categoryDetail: t.categoryDetail ?? '',
      priority: t.priority,
      status: t.status,
      lastMessageAt: t.lastMessageAt,
      lastMessagePreview: t.lastMessagePreview,
      unreadByTransporter: t.unreadByTransporter,
      unreadByRequester: t.unreadByRequester,
      unreadByAdmin: t.unreadByAdmin,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      ratingScore: t.ratingScore ?? null,
      ratingComment: t.ratingComment ?? null,
      ratedAt: t.ratedAt ?? null,
    },
    ...extra,
  }
}

module.exports = { buildSupportMessageSocketPayload, buildSupportTicketUpdatedPayload }
