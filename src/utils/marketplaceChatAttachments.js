const MAX_CHAT_ATTACHMENTS = 5

function normalizeAttachmentsInput(raw) {
  if (raw == null) return []
  const arr = Array.isArray(raw) ? raw : []
  const out = []
  for (const item of arr) {
    if (typeof item === 'string' && item.trim()) {
      out.push({
        url: item.trim(),
        mimeType: 'application/octet-stream',
        originalName: null,
        sizeBytes: null
      })
    } else if (item && typeof item === 'object' && item.url) {
      out.push({
        url: String(item.url).trim(),
        mimeType: String(item.mimeType || 'application/octet-stream'),
        originalName:
          item.originalName != null ? String(item.originalName) : null,
        sizeBytes: item.sizeBytes != null ? Number(item.sizeBytes) : null
      })
    }
  }
  return out
}

function bookingAllowsParticipantChat(booking) {
  if (!booking) return false
  const s = String(booking.status || '')
  return s !== 'REJECTED' && s !== 'CANCELLED'
}

/**
 * @param {string} contentTrim
 * @param {object[]} normalizedAttachments
 * @param {string} [messageType]
 * @param {number|null} proposedPrice
 */
function effectiveChatMessageType(
  contentTrim,
  normalizedAttachments,
  messageType,
  proposedPrice
) {
  const mt = (messageType || 'TEXT').toString().toUpperCase()
  if (
    mt === 'PRICE_PROPOSAL' ||
    mt === 'PRICE_COUNTER' ||
    (proposedPrice != null && proposedPrice !== '')
  ) {
    return mt === 'PRICE_COUNTER' ? 'PRICE_COUNTER' : 'PRICE_PROPOSAL'
  }
  if (normalizedAttachments.length > 0) return 'ATTACHMENT'
  return mt === 'ATTACHMENT' ? 'ATTACHMENT' : 'TEXT'
}

module.exports = {
  MAX_CHAT_ATTACHMENTS,
  normalizeAttachmentsInput,
  bookingAllowsParticipantChat,
  effectiveChatMessageType
}
