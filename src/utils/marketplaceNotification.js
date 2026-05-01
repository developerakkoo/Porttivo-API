/**
 * Shared MARKETPLACE_MESSAGE notification title, preview, and data for REST + socket paths.
 */

function senderNameFromPopulated(populatedMessageLean) {
  const s = populatedMessageLean?.senderId
  if (s && typeof s === 'object' && !(s instanceof Date)) {
    const n = (s.name || '').toString().trim()
    if (n) return n
  }
  return 'Someone'
}

function senderIdStringFromPopulated(populatedMessageLean) {
  const s = populatedMessageLean?.senderId
  if (s && typeof s === 'object' && s._id != null) {
    return s._id.toString()
  }
  if (s != null && typeof s.toString === 'function') {
    return s.toString()
  }
  return ''
}

function buildMarketplaceMessagePreview(messageType, content, proposedPrice) {
  const mt = (messageType || 'TEXT').toString().toUpperCase()
  if (mt === 'PRICE_PROPOSAL' && proposedPrice != null && proposedPrice !== '') {
    return `Proposed ₹${proposedPrice}`.slice(0, 200)
  }
  const c = (content || '').toString().trim()
  return c.slice(0, 200)
}

/**
 * @param {object} opts
 * @param {string|import('mongoose').Types.ObjectId} opts.bookingId
 * @param {object} opts.populatedMessageLean - TransporterMessage lean with senderId populated
 * @param {string} [opts.contentOverride] - raw content if message lean not fully available
 */
function buildMarketplaceMessageNotificationFields({
  bookingId,
  populatedMessageLean,
  contentOverride
}) {
  const senderName = senderNameFromPopulated(populatedMessageLean)
  const senderIdStr = senderIdStringFromPopulated(populatedMessageLean)
  const msgType = (populatedMessageLean?.messageType || 'TEXT').toString()
  const proposedPrice = populatedMessageLean?.proposedPrice
  const content =
    contentOverride != null
      ? contentOverride
      : (populatedMessageLean?.content ?? '')
  const preview = buildMarketplaceMessagePreview(
    msgType,
    content,
    proposedPrice
  )
  const bid =
    bookingId != null && bookingId.toString
      ? bookingId.toString()
      : String(bookingId)

  const data = {
    bookingId: bid,
    senderId: senderIdStr,
    senderName,
    messageType: msgType
  }
  if (proposedPrice != null && proposedPrice !== '') {
    data.proposedPrice = String(proposedPrice)
  }

  return {
    title: `Message from ${senderName}`,
    message: preview,
    data
  }
}

module.exports = {
  buildMarketplaceMessageNotificationFields,
  buildMarketplaceMessagePreview,
  senderNameFromPopulated
}
