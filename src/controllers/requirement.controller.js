const Requirement = require('../models/Requirement')
const Quote = require('../models/Quote')
const Transporter = require('../models/Transporter')
const { getTransporterActorId } = require('../utils/transporterActor')
const { validateLocationInput } = require('../utils/location')
const { notifyUsers } = require('../services/pushNotification.service')

function locationLabel(loc) {
  if (!loc) return ''
  if (typeof loc === 'string') return loc
  return loc.formattedAddress || ''
}

function serializeRequirement(r, extra = {}) {
  const requester =
    r.requesterId && typeof r.requesterId === 'object' && r.requesterId._id
      ? {
          id: r.requesterId._id,
          name: r.requesterId.name || null,
          company: r.requesterId.company || null,
          mobile: r.requesterId.mobile || null
        }
      : { id: r.requesterId }

  return {
    id: r._id,
    ref: r.ref,
    origin: locationLabel(r.origin),
    destination: locationLabel(r.destination),
    originLocation: r.origin || null,
    destinationLocation: r.destination || null,
    vehicleType: r.vehicleType,
    direction: r.direction,
    noOfVehicles: r.noOfVehicles,
    requiredBy: r.requiredBy,
    remarks: r.remarks,
    status: r.status,
    awardedQuoteId: r.awardedQuoteId || null,
    requester,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...extra
  }
}

function canViewRequirement(requirement, viewerId) {
  if (!requirement || !viewerId) return false
  if (requirement.requesterId?.toString() === String(viewerId)) return true
  return Array.isArray(requirement.broadcastTo)
    ? requirement.broadcastTo.some((id) => String(id) === String(viewerId))
    : false
}

// POST /api/requirements
const createRequirement = async (req, res, next) => {
  try {
    const requesterId = getTransporterActorId(req.user)
    if (!requesterId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can post inquiries'
      })
    }

    const {
      origin,
      destination,
      vehicleType,
      direction,
      noOfVehicles,
      requiredBy,
      remarks
    } = req.body

    const originErr = validateLocationInput(origin, 'origin', {
      required: true
    })
    if (originErr) {
      return res.status(400).json({ success: false, message: originErr })
    }
    const destErr = validateLocationInput(destination, 'destination', {
      required: true
    })
    if (destErr) {
      return res.status(400).json({ success: false, message: destErr })
    }
    if (!vehicleType || !String(vehicleType).trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'vehicleType is required' })
    }

    const dir = ['EXPORT', 'IMPORT', 'LOCAL'].includes(direction)
      ? direction
      : 'EXPORT'

    let requiredByDate = null
    if (requiredBy) {
      const d = new Date(requiredBy)
      if (!isNaN(d)) requiredByDate = d
    }

    const requirement = await Requirement.create({
      requesterId,
      origin,
      destination,
      vehicleType: String(vehicleType).trim(),
      direction: dir,
      noOfVehicles: Math.max(1, Number(noOfVehicles) || 1),
      requiredBy: requiredByDate,
      remarks: remarks ? String(remarks).trim() : null
    })

    requirement.ref = Requirement.buildRef(requirement._id)

    const transporters = await Transporter.find({
      status: 'active',
      hasAccess: true
    })
      .select('_id')
      .lean()

    const broadcastTo = transporters
      .map((t) => t._id?.toString())
      .filter(Boolean)

    requirement.broadcastTo = broadcastTo
    await requirement.save()

    const routeLabel = `${locationLabel(requirement.origin)} -> ${locationLabel(
      requirement.destination
    )}`

    notifyUsers(broadcastTo, {
      userType: 'TRANSPORTER',
      type: 'INQUIRY_BROADCAST',
      title: 'New Transport Inquiry',
      message: `${routeLabel} | ${requirement.vehicleType} | ${requirement.direction}`,
      data: {
        kind: 'INQUIRY_BROADCAST',
        requirementId: String(requirement._id),
        ref: requirement.ref,
        visibility: 'PUBLIC'
      },
      priority: 'high'
    }).catch((e) =>
      console.warn('Inquiry notification failed:', e.message || e)
    )

    return res.status(201).json({
      success: true,
      message: 'Inquiry posted',
      data: {
        requirement: serializeRequirement(requirement, {
          quoteCount: 0,
          matchedCount: broadcastTo.length
        })
      }
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/requirements/mine
const getMyRequirements = async (req, res, next) => {
  try {
    const requesterId = getTransporterActorId(req.user)
    if (!requesterId) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized' })
    }
    const list = await Requirement.find({ requesterId })
      .sort({ createdAt: -1 })
      .lean()

    const ids = list.map((r) => r._id)
    const counts = await Quote.aggregate([
      { $match: { requirementId: { $in: ids } } },
      { $group: { _id: '$requirementId', count: { $sum: 1 } } }
    ])
    const countMap = {}
    counts.forEach((c) => {
      countMap[c._id.toString()] = c.count
    })

    return res.status(200).json({
      success: true,
      data: {
        requirements: list.map((r) =>
          serializeRequirement(r, {
            quoteCount: countMap[r._id.toString()] || 0
          })
        )
      }
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/requirements/incoming
const getIncomingRequirements = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    if (!transporterId) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized' })
    }

    const list = await Requirement.find({
      status: 'OPEN',
      broadcastTo: transporterId
    })
      .sort({ createdAt: -1 })
      .populate('requesterId', 'name company mobile')
      .lean()

    const ids = list.map((r) => r._id)
    const myQuotes = await Quote.find({
      requirementId: { $in: ids },
      transporterId
    })
      .select('requirementId status price')
      .lean()
    const quotedMap = {}
    myQuotes.forEach((q) => {
      quotedMap[q.requirementId.toString()] = {
        status: q.status,
        price: q.price
      }
    })

    return res.status(200).json({
      success: true,
      data: {
        requirements: list.map((r) =>
          serializeRequirement(r, {
            myQuote: quotedMap[r._id.toString()] || null
          })
        )
      }
    })
  } catch (error) {
    next(error)
  }
}

// GET /api/requirements/:id
const getRequirementById = async (req, res, next) => {
  try {
    const viewerId = getTransporterActorId(req.user)
    if (!viewerId) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized' })
    }
    const { id } = req.params
    const r = await Requirement.findById(id)
      .populate('requesterId', 'name company mobile')
      .lean()
    if (!r) {
      return res
        .status(404)
        .json({ success: false, message: 'Requirement not found' })
    }

    const canView = canViewRequirement(r, viewerId)
    if (!canView) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this inquiry'
      })
    }

    const quoteCount = await Quote.countDocuments({ requirementId: id })
    const myQuote = await Quote.findOne({
      requirementId: id,
      transporterId: viewerId
    }).lean()

    return res.status(200).json({
      success: true,
      data: {
        requirement: serializeRequirement(r, {
          quoteCount,
          isOwner,
          myQuote: myQuote
            ? {
                id: myQuote._id,
                price: myQuote.price,
                status: myQuote.status,
                availability: myQuote.availability
              }
            : null
        })
      }
    })
  } catch (error) {
    next(error)
  }
}

// PATCH /api/requirements/:id/cancel
const cancelRequirement = async (req, res, next) => {
  try {
    const requesterId = getTransporterActorId(req.user)
    const { id } = req.params
    const r = await Requirement.findById(id)
    if (!r) {
      return res
        .status(404)
        .json({ success: false, message: 'Requirement not found' })
    }
    if (r.requesterId.toString() !== String(requesterId)) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized' })
    }
    if (r.status !== 'OPEN') {
      return res.status(400).json({
        success: false,
        message: `Only OPEN inquiries can be cancelled (current: ${r.status})`
      })
    }
    r.status = 'CANCELLED'
    await r.save()
    return res
      .status(200)
      .json({ success: true, message: 'Inquiry cancelled' })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  createRequirement,
  getMyRequirements,
  getIncomingRequirements,
  getRequirementById,
  cancelRequirement,
  serializeRequirement,
  locationLabel
}
