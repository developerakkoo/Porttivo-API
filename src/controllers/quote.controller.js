const mongoose = require('mongoose')
const Requirement = require('../models/Requirement')
const Quote = require('../models/Quote')
const { getTransporterActorId } = require('../utils/transporterActor')
const { createTripFromQuote } = require('../services/requirementToTrip.service')
const { notifyUser } = require('../services/pushNotification.service')

function locationLabel(loc) {
  if (!loc) return ''
  if (typeof loc === 'string') return loc
  return loc.formattedAddress || ''
}

function serializeQuote(q, requirement) {
  const t =
    q.transporterId && typeof q.transporterId === 'object' && q.transporterId._id
      ? q.transporterId
      : null
  const respondedInMinutes =
    requirement && q.createdAt
      ? Math.max(
          0,
          Math.round(
            (new Date(q.createdAt).getTime() -
              new Date(requirement.createdAt).getTime()) /
              60000
          )
        )
      : null

  return {
    id: q._id,
    requirementId: q.requirementId,
    price: q.price,
    availability: q.availability,
    availabilityDate: q.availabilityDate,
    message: q.message,
    status: q.status,
    counterPrice: q.counterPrice ?? null,
    tripId: q.tripId || null,
    createdAt: q.createdAt,
    respondedInMinutes,
    transporter: t
      ? {
          id: t._id,
          name: t.name || null,
          company: t.company || null,
          rating: t.rating ?? null,
          ratingCount: t.ratingCount ?? 0
        }
      : { id: q.transporterId }
  }
}

// POST /api/requirements/:id/quotes  (transporter submits/updates a quote)
const submitQuote = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Only transporter accounts can submit quotes'
      })
    }
    const requirementId = req.params.id
    const { price, availability, availabilityDate, message } = req.body

    if (price == null || isNaN(Number(price)) || Number(price) < 0) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid price is required' })
    }

    const requirement = await Requirement.findById(requirementId)
    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: 'Requirement not found' })
    }
    if (requirement.requesterId.toString() === String(transporterId)) {
      return res.status(400).json({
        success: false,
        message: 'You cannot quote on your own inquiry'
      })
    }
    if (requirement.status !== 'OPEN') {
      return res.status(400).json({
        success: false,
        message: `This inquiry is no longer open (status: ${requirement.status})`
      })
    }

    const avail = ['TODAY', 'TOMORROW', 'CUSTOM'].includes(availability)
      ? availability
      : 'TODAY'
    let availDate = null
    if (avail === 'CUSTOM' && availabilityDate) {
      const d = new Date(availabilityDate)
      if (!isNaN(d)) availDate = d
    }

    // Upsert: one quote per transporter per requirement (re-submit updates it).
    const quote = await Quote.findOneAndUpdate(
      { requirementId, transporterId },
      {
        requirementId,
        transporterId,
        price: Number(price),
        availability: avail,
        availabilityDate: availDate,
        message: message ? String(message).trim() : null,
        status: 'SUBMITTED'
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    // Notify the requester.
    const routeLabel = `${locationLabel(requirement.origin)} → ${locationLabel(
      requirement.destination
    )}`
    notifyUser({
      userId: requirement.requesterId,
      userType: 'TRANSPORTER',
      type: 'QUOTE_RECEIVED',
      title: 'New Quote Received',
      message: `₹${Number(price).toLocaleString('en-IN')} · ${routeLabel}`,
      data: {
        kind: 'QUOTE_RECEIVED',
        requirementId: String(requirement._id),
        quoteId: String(quote._id),
        ref: requirement.ref
      },
      priority: 'high'
    }).catch((e) => console.warn('Quote push failed:', e.message || e))

    return res
      .status(201)
      .json({ success: true, message: 'Quote submitted', data: { quote } })
  } catch (error) {
    if (error && error.code === 11000) {
      return res
        .status(400)
        .json({ success: false, message: 'You already quoted this inquiry' })
    }
    next(error)
  }
}

// GET /api/requirements/:id/quotes  (requester views quotes)
const getQuotesForRequirement = async (req, res, next) => {
  try {
    const viewerId = getTransporterActorId(req.user)
    const requirementId = req.params.id
    const requirement = await Requirement.findById(requirementId).lean()
    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: 'Requirement not found' })
    }
    if (requirement.requesterId.toString() !== String(viewerId)) {
      return res
        .status(403)
        .json({ success: false, message: 'Only the requester can view quotes' })
    }

    const quotes = await Quote.find({ requirementId })
      .sort({ price: 1, createdAt: 1 })
      .populate('transporterId', 'name company rating ratingCount')
      .lean()

    return res.status(200).json({
      success: true,
      data: {
        quotes: quotes.map((q) => serializeQuote(q, requirement))
      }
    })
  } catch (error) {
    next(error)
  }
}

// PUT /api/quotes/:id/select  (requester awards a quote)
const selectQuote = async (req, res, next) => {
  try {
    const requesterId = getTransporterActorId(req.user)
    const quoteId = req.params.id

    const quote = await Quote.findById(quoteId)
    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: 'Quote not found' })
    }
    const requirement = await Requirement.findById(quote.requirementId)
    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: 'Requirement not found' })
    }
    if (requirement.requesterId.toString() !== String(requesterId)) {
      return res
        .status(403)
        .json({ success: false, message: 'Only the requester can select' })
    }
    if (requirement.status !== 'OPEN') {
      return res.status(400).json({
        success: false,
        message: `This inquiry is already ${requirement.status.toLowerCase()}`
      })
    }

    const session = await mongoose.startSession()
    session.startTransaction()
    let trip = null
    try {
      quote.status = 'SELECTED'
      await quote.save({ session })

      await Quote.updateMany(
        { requirementId: requirement._id, _id: { $ne: quote._id } },
        { $set: { status: 'NOT_SELECTED' } },
        { session }
      )

      requirement.status = 'AWARDED'
      requirement.awardedQuoteId = quote._id
      await requirement.save({ session })

      trip = await createTripFromQuote(requirement, quote, { session })

      await session.commitTransaction()
      session.endSession()
    } catch (txErr) {
      await session.abortTransaction()
      session.endSession()
      throw txErr
    }

    const routeLabel = `${locationLabel(requirement.origin)} → ${locationLabel(
      requirement.destination
    )}`

    // Winner
    notifyUser({
      userId: quote.transporterId,
      userType: 'TRANSPORTER',
      type: 'QUOTE_SELECTED',
      title: 'Inquiry Awarded!',
      message: `Your quote for ${routeLabel} was accepted at ₹${Number(
        quote.price
      ).toLocaleString('en-IN')}`,
      data: {
        kind: 'QUOTE_SELECTED',
        requirementId: String(requirement._id),
        quoteId: String(quote._id),
        tripId: trip ? String(trip._id) : '',
        ref: requirement.ref
      },
      priority: 'high'
    }).catch((e) => console.warn('Award push failed:', e.message || e))

    // Losers
    try {
      const losers = await Quote.find({
        requirementId: requirement._id,
        _id: { $ne: quote._id }
      })
        .select('transporterId')
        .lean()
      losers.forEach((l) => {
        notifyUser({
          userId: l.transporterId,
          userType: 'TRANSPORTER',
          type: 'QUOTE_NOT_SELECTED',
          title: 'Inquiry Update',
          message: `Another transporter was selected for ${routeLabel}`,
          data: {
            kind: 'QUOTE_NOT_SELECTED',
            requirementId: String(requirement._id),
            ref: requirement.ref
          }
        }).catch(() => {})
      })
    } catch (e) {
      console.warn('Loser notifications skipped:', e.message || e)
    }

    return res.status(200).json({
      success: true,
      message: 'Quote selected',
      data: {
        quote: { id: quote._id, status: quote.status, tripId: quote.tripId },
        tripId: trip ? trip._id : null,
        requirement: { id: requirement._id, status: requirement.status }
      }
    })
  } catch (error) {
    next(error)
  }
}

// PUT /api/quotes/:id/counter  (requester proposes a counter price)
const counterQuote = async (req, res, next) => {
  try {
    const requesterId = getTransporterActorId(req.user)
    const quoteId = req.params.id
    const { counterPrice } = req.body

    if (counterPrice == null || isNaN(Number(counterPrice)) || Number(counterPrice) < 0) {
      return res
        .status(400)
        .json({ success: false, message: 'A valid counterPrice is required' })
    }

    const quote = await Quote.findById(quoteId)
    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: 'Quote not found' })
    }
    const requirement = await Requirement.findById(quote.requirementId)
    if (!requirement) {
      return res
        .status(404)
        .json({ success: false, message: 'Requirement not found' })
    }
    if (requirement.requesterId.toString() !== String(requesterId)) {
      return res
        .status(403)
        .json({ success: false, message: 'Only the requester can counter' })
    }
    if (requirement.status !== 'OPEN' || quote.status !== 'SUBMITTED') {
      return res.status(400).json({
        success: false,
        message: 'This quote can no longer be countered'
      })
    }

    quote.counterPrice = Number(counterPrice)
    await quote.save()

    notifyUser({
      userId: quote.transporterId,
      userType: 'TRANSPORTER',
      type: 'QUOTE_COUNTERED',
      title: 'Counter Offer',
      message: `Requester countered at ₹${Number(counterPrice).toLocaleString(
        'en-IN'
      )}`,
      data: {
        kind: 'QUOTE_COUNTERED',
        requirementId: String(requirement._id),
        quoteId: String(quote._id),
        ref: requirement.ref
      },
      priority: 'high'
    }).catch((e) => console.warn('Counter push failed:', e.message || e))

    return res
      .status(200)
      .json({ success: true, message: 'Counter offer sent', data: { quote } })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/quotes/:id  (transporter withdraws their quote)
const withdrawQuote = async (req, res, next) => {
  try {
    const transporterId = getTransporterActorId(req.user)
    const quote = await Quote.findById(req.params.id)
    if (!quote) {
      return res
        .status(404)
        .json({ success: false, message: 'Quote not found' })
    }
    if (quote.transporterId.toString() !== String(transporterId)) {
      return res
        .status(403)
        .json({ success: false, message: 'Not authorized' })
    }
    if (quote.status === 'SELECTED') {
      return res.status(400).json({
        success: false,
        message: 'An awarded quote cannot be withdrawn'
      })
    }
    quote.status = 'WITHDRAWN'
    await quote.save()
    return res
      .status(200)
      .json({ success: true, message: 'Quote withdrawn' })
  } catch (error) {
    next(error)
  }
}

module.exports = {
  submitQuote,
  getQuotesForRequirement,
  selectQuote,
  counterQuote,
  withdrawQuote,
  serializeQuote
}
