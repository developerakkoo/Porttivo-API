function formatCurrencyAmount(amount) {
  const value = Number(amount)
  if (!Number.isFinite(value)) {
    return null
  }
  return `₹${value.toFixed(2).replace(/\.00$/, '')}`
}

function buildMarketplacePaymentReadyNotificationFields({
  tripId,
  tripPublicId,
  bookingId,
  amount,
  milestoneNumber = 1,
  audience = 'buyer'
}) {
  const amountLabel = formatCurrencyAmount(amount) || 'the negotiated amount'
  const publicTripId = tripPublicId || tripId
  const bid = bookingId != null && bookingId.toString ? bookingId.toString() : String(bookingId || '')
  const isSeller = audience === 'seller'

  return {
    title: isSeller
      ? 'Payment unlocked for marketplace trip'
      : 'Marketplace payment is ready',
    message: isSeller
      ? `Milestone ${milestoneNumber} is complete for trip ${publicTripId}. The buyer can now pay ${amountLabel}.`
      : `Milestone ${milestoneNumber} is complete for trip ${publicTripId}. You can pay ${amountLabel} now.`,
    data: {
      event: 'MARKETPLACE_PAYMENT_READY',
      tripId: tripId ? String(tripId) : null,
      tripPublicId: publicTripId ? String(publicTripId) : null,
      bookingId: bid,
      amount: Number(amount) || null,
      milestoneNumber,
      audience
    }
  }
}

module.exports = {
  buildMarketplacePaymentReadyNotificationFields,
  formatCurrencyAmount
}
