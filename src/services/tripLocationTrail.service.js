const mongoose = require('mongoose')
const TripLocationLog = require('../models/TripLocationLog')
const { TRIP_STATUS } = require('../utils/tripState')

const TRACKABLE_STATUSES = [
  TRIP_STATUS.ACTIVE,
  TRIP_STATUS.PAUSED,
  TRIP_STATUS.POD_PENDING,
]

const MAX_LIMIT = 2000
const DEFAULT_LIMIT = 2000

function decimatePoints(points, maxPoints) {
  if (points.length <= maxPoints) return points
  const result = []
  const step = (points.length - 1) / (maxPoints - 1)
  for (let i = 0; i < maxPoints; i++) {
    const idx = i === maxPoints - 1 ? points.length - 1 : Math.round(i * step)
    result.push(points[idx])
  }
  return result
}

/**
 * @param {string} tripId
 * @param {{ since?: string, limit?: number }} options
 */
async function getLocationTrailForTrip(tripId, options = {}) {
  if (!mongoose.Types.ObjectId.isValid(tripId)) {
    const err = new Error('Invalid trip id')
    err.status = 400
    throw err
  }

  const cap = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(options.limit, 10) || DEFAULT_LIMIT)
  )

  const filter = {
    tripId: new mongoose.Types.ObjectId(tripId),
    eventType: 'LOCATION_UPDATE',
  }

  if (options.since) {
    const sinceDate = new Date(options.since)
    if (!Number.isNaN(sinceDate.getTime())) {
      filter.createdAt = { $gt: sinceDate }
    }
  }

  const total = await TripLocationLog.countDocuments(filter)

  let rows = await TripLocationLog.find(filter)
    .sort({ createdAt: 1 })
    .select('latitude longitude createdAt speed heading accuracy')
    .lean()

  if (rows.length > cap) {
    rows = decimatePoints(rows, cap)
  }

  return {
    points: rows.map(r => ({
      latitude: r.latitude,
      longitude: r.longitude,
      createdAt: r.createdAt,
      speed: r.speed ?? null,
      heading: r.heading ?? null,
    })),
    total,
    returned: rows.length,
  }
}

module.exports = {
  TRACKABLE_STATUSES,
  decimatePoints,
  getLocationTrailForTrip,
}
