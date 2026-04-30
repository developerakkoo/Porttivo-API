/**
 * Normalized Socket.IO payload for T2T marketplace chat (Flutter expects string bookingId on message).
 */
function buildChatMessageSocketPayload(bookingId, populatedMessageLean, senderId) {
  const bid =
    bookingId != null && bookingId.toString
      ? bookingId.toString()
      : String(bookingId)
  const sid =
    senderId != null && senderId.toString
      ? senderId.toString()
      : String(senderId)

  const m = populatedMessageLean
    ? {
        ...populatedMessageLean,
        bookingId:
          populatedMessageLean.bookingId != null
            ? populatedMessageLean.bookingId.toString()
            : bid
      }
    : null

  return {
    bookingId: bid,
    message: m,
    senderId: sid,
    timestamp: new Date()
  }
}

module.exports = { buildChatMessageSocketPayload }
