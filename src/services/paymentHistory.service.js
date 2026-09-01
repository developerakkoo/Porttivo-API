const mongoose = require('mongoose')
const PaymentSession = require('../models/PaymentSession')
const Payout = require('../models/Payout')
const MarketplacePayment = require('../models/MarketplacePayment')
const RazorpayPaymentLink = require('../models/RazorpayPaymentLink')

const toObjectId = (val) => {
  if (!val) return null
  if (val instanceof mongoose.Types.ObjectId) return val
  return mongoose.Types.ObjectId.isValid(val) ? new mongoose.Types.ObjectId(val) : null
}

const safeString = (val) => (val != null ? String(val).trim() : '')

const normalizeFilterValue = (val) => {
  const normalized = safeString(val).toUpperCase()
  if (!normalized || normalized === 'ALL') {
    return null
  }

  return normalized
}

/**
 * Fetch and aggregate complete payment history for a transporter (Received & Transferred).
 */
const getTransporterUnifiedPaymentHistory = async ({
  transporterId,
  direction = 'ALL', // 'ALL' | 'RECEIVED' | 'TRANSFERRED'
  status = null,
  provider = null,
  category = null,
  fromDate = null,
  toDate = null,
  search = null,
  page = 1,
  limit = 20
}) => {
  const tIdStr = safeString(transporterId)
  const tIdObj = toObjectId(transporterId)
  if (!tIdStr) {
    throw new Error('Transporter ID is required')
  }

  const normalizedDirection = safeString(direction).toUpperCase() || 'ALL'
  const normalizedStatus = normalizeFilterValue(status)
  const normalizedProvider = normalizeFilterValue(provider)
  const normalizedCategory = normalizeFilterValue(category)

  // Construct date filters
  const dateFilter = {}
  if (fromDate) {
    dateFilter.$gte = new Date(fromDate)
  }
  if (toDate) {
    const end = new Date(toDate)
    end.setHours(23, 59, 59, 999)
    dateFilter.$lte = end
  }
  const hasDateFilter = Object.keys(dateFilter).length > 0

  // 1. Fetch PaymentSessions
  const psFilter = {
    $or: [
      { 'metadata.transporterId': tIdObj || tIdStr },
      { 'initiatedBy.userId': tIdObj || tIdStr, 'initiatedBy.userType': 'transporter' },
      { 'payer.userId': tIdObj || tIdStr },
      { 'metadata.payout.payeeId': tIdStr },
      { 'metadata.payeeId': tIdStr }
    ]
  }
  if (normalizedStatus) psFilter.status = normalizedStatus
  if (normalizedProvider) psFilter.provider = normalizedProvider
  if (hasDateFilter) psFilter.createdAt = dateFilter

  const paymentSessions = await PaymentSession.find(psFilter).lean()

  // Find linked Payouts for payment sessions
  const psIds = paymentSessions.map((ps) => ps._id)
  const linkedPayouts = psIds.length
    ? await Payout.find({ paymentId: { $in: psIds } }).lean()
    : []
  const payoutMapByPaymentId = new Map()
  linkedPayouts.forEach((po) => {
    payoutMapByPaymentId.set(String(po.paymentId), po)
  })

  // 2. Fetch standalone Payouts where transporter is payer or payee
  const poFilter = {
    $or: [
      { payerId: tIdObj || tIdStr },
      { payeeId: tIdObj || tIdStr }
    ]
  }
  if (normalizedStatus) poFilter.status = normalizedStatus
  if (normalizedProvider) poFilter.provider = normalizedProvider
  if (hasDateFilter) poFilter.createdAt = dateFilter

  const allPayouts = await Payout.find(poFilter).lean()
  const standalonePayouts = allPayouts.filter(
    (po) => !po.paymentId || !psIds.some((id) => String(id) === String(po.paymentId))
  )

  // 3. Fetch MarketplacePayments
  const mpFilter = {
    $or: [
      { payerTransporterId: tIdObj || tIdStr },
      { beneficiaryTransporterId: tIdObj || tIdStr }
    ]
  }
  if (normalizedStatus) mpFilter.status = normalizedStatus
  if (normalizedProvider) mpFilter.provider = normalizedProvider
  if (hasDateFilter) mpFilter.createdAt = dateFilter

  const marketplacePayments = await MarketplacePayment.find(mpFilter).lean()

  // 4. Fetch RazorpayPaymentLinks
  const plFilter = {
    $or: [
      { payerTransporterId: tIdObj || tIdStr },
      { beneficiaryTransporterId: tIdObj || tIdStr }
    ]
  }
  if (normalizedStatus) plFilter.status = normalizedStatus
  if (hasDateFilter) plFilter.createdAt = dateFilter

  const paymentLinks = await RazorpayPaymentLink.find(plFilter).lean()

  // Process & Normalize into unified transaction items
  const items = []

  // Transform PaymentSessions
  paymentSessions.forEach((ps) => {
    const linkedPayout = payoutMapByPaymentId.get(String(ps._id)) || null
    const payerIdStr = safeString(ps.payer?.userId || ps.initiatedBy?.userId)
    const payeeIdStr = safeString(ps.metadata?.payout?.payeeId || ps.metadata?.payeeId)

    let dir = 'TRANSFERRED'
    if (payeeIdStr === tIdStr && payerIdStr !== tIdStr) {
      dir = 'RECEIVED'
    } else if (payerIdStr === tIdStr) {
      dir = 'TRANSFERRED'
    } else if (safeString(ps.metadata?.transporterId) === tIdStr && ps.purpose === 'DRIVER_ADVANCE') {
      dir = 'TRANSFERRED'
    }

    let cat = ps.purpose === 'DRIVER_ADVANCE' ? 'DRIVER_ADVANCE' : 'INVOICE'
    if (ps.referenceType) cat = safeString(ps.referenceType).toUpperCase()

    items.push({
      id: String(ps._id),
      paymentId: ps._id,
      publicId: ps.publicId || String(ps._id),
      referenceId: ps.referenceId || null,
      referenceType: ps.referenceType || 'PAYMENT_SESSION',
      direction: dir,
      type: dir,
      category: cat,
      purpose: ps.purpose || 'Payment Session',
      amount: Number(ps.amount || 0),
      currency: ps.currency || 'INR',
      paymentStatus: ps.status,
      paymentDate: ps.completedAt || ps.createdAt,
      createdAt: ps.createdAt,
      provider: ps.provider,
      providerTransactionId: ps.providerTransactionId || null,
      providerOrderId: ps.providerOrderId || null,
      payoutStatus: linkedPayout ? linkedPayout.status : 'NOT_CREATED',
      counterparty: {
        id: dir === 'TRANSFERRED' ? payeeIdStr || null : payerIdStr || null,
        name: ps.payer?.name || null,
        mobile: ps.payer?.mobile || null,
        email: ps.payer?.email || null,
        userType: dir === 'TRANSFERRED' ? (ps.metadata?.payout?.payeeType || 'DRIVER') : (ps.payer?.userType || 'CUSTOMER')
      },
      payout: linkedPayout
        ? {
            id: linkedPayout._id,
            status: linkedPayout.status,
            transferId: linkedPayout.cashfree?.transferId || linkedPayout.razorpay?.payoutId || null,
            utr: linkedPayout.cashfree?.utr || null,
            transferMode: linkedPayout.cashfree?.transferMode || linkedPayout.razorpay?.transferMode || 'IMPS',
            completedAt: linkedPayout.completedAt || null
          }
        : null,
      metadata: ps.metadata || {}
    })
  })

  // Transform Standalone Payouts
  standalonePayouts.forEach((po) => {
    const isPayee = safeString(po.payeeId) === tIdStr
    const dir = isPayee ? 'RECEIVED' : 'TRANSFERRED'
    const cat = po.referenceType ? safeString(po.referenceType).toUpperCase() : 'DIRECT_PAYOUT'

    items.push({
      id: String(po._id),
      paymentId: po.paymentId || po._id,
      publicId: `pout_${po._id}`,
      referenceId: po.referenceId || null,
      referenceType: po.referenceType || 'PAYOUT',
      direction: dir,
      type: dir,
      category: cat,
      purpose: isPayee ? 'Payout Received' : 'Payout Disbursed',
      amount: Number(po.amount || 0),
      currency: po.currency || 'INR',
      paymentStatus: po.status === 'SUCCESS' ? 'SUCCESS' : po.status,
      paymentDate: po.completedAt || po.initiatedAt || po.createdAt,
      createdAt: po.createdAt,
      provider: po.provider || 'CASHFREE',
      providerTransactionId: po.cashfree?.transferId || po.razorpay?.payoutId || null,
      providerOrderId: null,
      payoutStatus: po.status,
      counterparty: {
        id: isPayee ? safeString(po.payerId) || null : safeString(po.payeeId) || null,
        name: null,
        mobile: null,
        email: null,
        userType: isPayee ? 'PAYER' : (po.payeeType || 'PAYEE')
      },
      payout: {
        id: po._id,
        status: po.status,
        transferId: po.cashfree?.transferId || po.razorpay?.payoutId || null,
        utr: po.cashfree?.utr || null,
        transferMode: po.cashfree?.transferMode || po.razorpay?.transferMode || 'IMPS',
        completedAt: po.completedAt || null
      },
      metadata: {}
    })
  })

  // Transform MarketplacePayments
  marketplacePayments.forEach((mp) => {
    const isSeller = safeString(mp.beneficiaryTransporterId) === tIdStr
    const dir = isSeller ? 'RECEIVED' : 'TRANSFERRED'

    items.push({
      id: String(mp._id),
      paymentId: mp._id,
      publicId: mp.publicId || String(mp._id),
      referenceId: mp.tripId ? String(mp.tripId) : (mp.bookingId ? String(mp.bookingId) : null),
      referenceType: 'MARKETPLACE_BOOKING',
      direction: dir,
      type: dir,
      category: isSeller ? 'MARKETPLACE_EARNING' : 'MARKETPLACE_BOOKING',
      purpose: isSeller ? 'Marketplace Vehicle Booking Payment Received' : 'Marketplace Vehicle Booking Pay-in',
      amount: Number(mp.amount || 0),
      currency: mp.currency || 'INR',
      paymentStatus: mp.status,
      paymentDate: mp.completedAt || mp.createdAt,
      createdAt: mp.createdAt,
      provider: mp.provider || 'RAZORPAY',
      providerTransactionId: mp.providerTransactionId || null,
      providerOrderId: mp.providerOrderId || null,
      payoutStatus: 'NOT_APPLICABLE',
      counterparty: {
        id: isSeller ? safeString(mp.payerTransporterId) : safeString(mp.beneficiaryTransporterId),
        name: null,
        mobile: null,
        email: null,
        userType: 'TRANSPORTER'
      },
      payout: null,
      metadata: mp.metadata || {}
    })
  })

  // Transform RazorpayPaymentLinks
  paymentLinks.forEach((pl) => {
    const isBeneficiary = safeString(pl.beneficiaryTransporterId) === tIdStr
    const dir = isBeneficiary ? 'RECEIVED' : 'TRANSFERRED'

    items.push({
      id: String(pl._id),
      paymentId: pl._id,
      publicId: pl.publicId || String(pl._id),
      referenceId: pl.referenceId || pl.businessReferenceId || null,
      referenceType: pl.businessReferenceType || 'PAYMENT_LINK',
      direction: dir,
      type: dir,
      category: 'PAYMENT_LINK',
      purpose: pl.description || (isBeneficiary ? 'Payment Link Received' : 'Payment Link Sent'),
      amount: Number(pl.amount || 0),
      currency: pl.currency || 'INR',
      paymentStatus: pl.status === 'PAID' ? 'SUCCESS' : pl.status,
      paymentDate: pl.paidAt || pl.createdAt,
      createdAt: pl.createdAt,
      provider: 'RAZORPAY',
      providerTransactionId: pl.razorpayPaymentId || null,
      providerOrderId: pl.razorpayOrderId || null,
      payoutStatus: pl.transferStatus || 'NOT_APPLICABLE',
      counterparty: {
        id: isBeneficiary ? safeString(pl.payerTransporterId) : safeString(pl.beneficiaryTransporterId),
        name: null,
        mobile: null,
        email: null,
        userType: isBeneficiary ? 'PAYER' : 'TRANSPORTER'
      },
      payout: null,
      metadata: pl.metadata || {}
    })
  })

  // Apply filters in memory across aggregated dataset
  let filtered = items

  // Direction filter
  if (normalizedDirection === 'RECEIVED') {
    filtered = filtered.filter((i) => i.direction === 'RECEIVED')
  } else if (normalizedDirection === 'TRANSFERRED' || normalizedDirection === 'TRANSFER') {
    filtered = filtered.filter((i) => i.direction === 'TRANSFERRED')
  }

  // Status filter
  if (normalizedStatus && normalizedStatus !== 'ALL') {
    filtered = filtered.filter((i) => i.paymentStatus === normalizedStatus)
  }

  // Provider filter
  if (normalizedProvider) {
    filtered = filtered.filter((i) => i.provider === normalizedProvider)
  }

  // Category filter
  if (normalizedCategory) {
    filtered = filtered.filter((i) => i.category === normalizedCategory)
  }

  // Search filter
  if (search && safeString(search)) {
    const q = safeString(search).toLowerCase()
    filtered = filtered.filter((i) => {
      const matchRef = safeString(i.referenceId).toLowerCase().includes(q)
      const matchTxn = safeString(i.providerTransactionId).toLowerCase().includes(q)
      const matchOrder = safeString(i.providerOrderId).toLowerCase().includes(q)
      const matchPurpose = safeString(i.purpose).toLowerCase().includes(q)
      const matchPublic = safeString(i.publicId).toLowerCase().includes(q)
      const matchCpName = safeString(i.counterparty?.name).toLowerCase().includes(q)
      const matchCpMobile = safeString(i.counterparty?.mobile).toLowerCase().includes(q)
      return matchRef || matchTxn || matchOrder || matchPurpose || matchPublic || matchCpName || matchCpMobile
    })
  }

  // Sort descending by date
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  // Calculate summary metrics from the filtered ledger view so the summary
  // matches the records the caller is actually looking at.
  let totalReceivedAmount = 0
  let totalTransferredAmount = 0
  let totalReceivedCount = 0
  let totalTransferredCount = 0
  let pendingReceivedAmount = 0
  let pendingTransferredAmount = 0

  filtered.forEach((i) => {
    const isSuccess = i.paymentStatus === 'SUCCESS' || i.paymentStatus === 'PAID'
    const isPending = i.paymentStatus === 'PENDING' || i.paymentStatus === 'CREATED'

    if (i.direction === 'RECEIVED') {
      if (isSuccess) {
        totalReceivedAmount += i.amount
        totalReceivedCount++
      } else if (isPending) {
        pendingReceivedAmount += i.amount
      }
    } else if (i.direction === 'TRANSFERRED') {
      if (isSuccess) {
        totalTransferredAmount += i.amount
        totalTransferredCount++
      } else if (isPending) {
        pendingTransferredAmount += i.amount
      }
    }
  })

  // Pagination
  const total = filtered.length
  const pageNum = Math.max(Number(page) || 1, 1)
  const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const skip = (pageNum - 1) * limitNum
  const paginatedPayments = filtered.slice(skip, skip + limitNum)

  return {
    page: pageNum,
    limit: limitNum,
    total,
    count: paginatedPayments.length,
    totalPages: Math.ceil(total / limitNum) || 1,
    hasNext: pageNum * limitNum < total,
    hasPrevious: pageNum > 1,
    summary: {
      totalReceivedAmount,
      totalTransferredAmount,
      netAmount: totalReceivedAmount - totalTransferredAmount,
      totalReceivedCount,
      totalTransferredCount,
      pendingReceivedAmount,
      pendingTransferredAmount
    },
    payments: paginatedPayments
  }
}

module.exports = {
  getTransporterUnifiedPaymentHistory
}
