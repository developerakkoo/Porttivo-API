const Requirement = require('../models/Requirement')
const Quote = require('../models/Quote')
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability')
const Transporter = require('../models/Transporter')
const { getTransporterActorId } = require('../utils/transporterActor')
const { validateLocationInput } = require('../utils/location')
const { notifyUsers } = require('../services/pushNotification.service')

const escapeRegex = (s) => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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

/**
 * Transporters with an ACTIVE listing whose vehicleType matches and whose
 * origin/destination/routes overlap the inquiry route. Excludes the requester.
 */
async function findMatchingTransporterIds(requirement, excludeId) {
  const tokens = []
  const originLabel = locationLabel(requirement.origin)
  const destLabel = locationLabel(requirement.destination)
  if (originLabel) tokens.push(originLabel)
  if (destLabel) tokens.push(destLabel)

  const orClauses = []
  for (const t of tokens) {
    const p = escapeRegex(String(t).trim())
    if (!p) continue
    orClauses.push(
      { 'origin.formattedAddress': { $regex: p, $options: 'i' } },
      { 'destination.formattedAddress': { $regex: p, $options: 'i' } },
      {
        destinations: {
          $elemMatch: { formattedAddress: { $regex: p, $options: 'i' } }
        }
      },
      {
        routes: {
          $elemMatch: {
            'destination.formattedAddress': { $regex: p, $options: 'i' }
          }
        }
      }
    )
  }

  const query = { status: 'active', vehicleType: requirement.vehicleType }
  if (orClauses.length) query.$or = orClauses

  const posts = await VehicleRouteAvailability.find(query)
    .select('transporterId')
    .lean()

  const ids = new Set()
  for (const p of posts) {
    const id = p.transporterId?.toString()
    if (id && id !== String(excludeId)) ids.add(id)
  }
  return [...ids]
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

    // Assign human-readable ref now that we have an _id.
    requirement.ref = Requirement.buildRef(requirement._id)

    // Match + broadcast (best-effort; never blocks the create).
    let matchedIds = []
    try {
      matchedIds = await findMatchingTransporterIds(requirement, requesterId)
      requirement.broadcastTo = matchedIds
    } catch (matchErr) {
      console.warn('Requirement matching failed:', matchErr.message || matchErr)
    }
    await requirement.save()

    const routeLabel = `${locationLabel(requirement.origin)} → ${locationLabel(
      requirement.destination
    )}`
    notifyUsers(matchedIds, {
      userType: 'TRANSPORTER',
      type: 'INQUIRY_BROADCAST',
      title: 'New Transport Inquiry',
      message: `${routeLabel} · ${requirement.vehicleType} · ${requirement.direction}`,
      data: {
        kind: 'INQUIRY_BROADCAST',
        requirementId: String(requirement._id),
        ref: requirement.ref
      },
      priority: 'high'
    }).catch((e) =>
      console.warn('Inquiry broadcast push failed:', e.message || e)
    )

    return res.status(201).json({
      success: true,
      message: 'Inquiry posted',
      data: {
        requirement: serializeRequirement(requirement, {
          quoteCount: 0,
          matchedCount: matchedIds.length
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

// GET /api/requirements/incoming  (transporter feed of matched OPEN inquiries)
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

    // Which of these has the caller already quoted?
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

    const isOwner = r.requesterId?._id?.toString() === String(viewerId)
    const quoteCount = await Quote.countDocuments({ requirementId: id })

    let myQuote = null
    if (!isOwner) {
      myQuote = await Quote.findOne({
        requirementId: id,
        transporterId: viewerId
      }).lean()
    }

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
