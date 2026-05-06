/**
 * Per-destination quotas on VehicleRouteAvailability + servedStopIndexes on assignments.
 */

/**
 * @param {object|null} primary
 * @param {object[]} additional
 * @returns {number} number of canonical stops (at least 1 for listing capacity)
 */
function canonicalDestinationStopCount(primary, additional) {
  const rest = Array.isArray(additional) ? additional : []
  const all = [primary, ...rest].filter(
    x =>
      x &&
      String(x.formattedAddress ?? x.address ?? '')
        .trim()
        .length > 0
  )
  return Math.max(1, all.length)
}

/**
 * Resolved quotas aligned with stop indices (legacy: quantity on stop 0 only).
 * @param {object} post - mongoose doc or lean
 * @returns {number[]}
 */
function getDestinationQuantitiesResolved(post) {
  const n = canonicalDestinationStopCount(post.destination, post.destinations)
  const arr = post.destinationQuantities
  if (
    Array.isArray(arr) &&
    arr.length === n &&
    arr.every(x => x != null && Number.isFinite(Number(x)))
  ) {
    return arr.map(x => Math.max(0, Math.floor(Number(x))))
  }
  const q = Math.max(1, Math.floor(Number(post.quantity)) || 1)
  const out = new Array(n).fill(0)
  out[0] = q
  return out
}

/**
 * @param {object} body - req.body
 * @param {number} numStops
 * @param {number|string|undefined} legacyQuantity - from req.body.quantity
 * @returns {{ ok: true, quantities: number[] } | { ok: false, message: string }}
 */
function parseDestinationQuantitiesInput(body, numStops, legacyQuantity) {
  const raw = body.destinationQuantities
  if (!Array.isArray(raw) || raw.length === 0) {
    const q = Math.max(1, Number(legacyQuantity) || 1)
    if (numStops === 1) {
      return { ok: true, quantities: [q] }
    }
    const arr = new Array(numStops).fill(0)
    arr[0] = q
    return { ok: true, quantities: arr }
  }
  if (raw.length !== numStops) {
    return {
      ok: false,
      message: `destinationQuantities must have ${numStops} entries (one per destination stop, in order)`
    }
  }
  const quantities = []
  for (let i = 0; i < raw.length; i++) {
    const n = Number(raw[i])
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      return {
        ok: false,
        message: `destinationQuantities[${i}] must be a non-negative integer`
      }
    }
    quantities.push(n)
  }
  const sum = quantities.reduce((a, b) => a + b, 0)
  if (sum < 1) {
    return {
      ok: false,
      message: 'Sum of destination quantities must be at least 1'
    }
  }
  return { ok: true, quantities }
}

/**
 * @param {object[]} assignments - lean
 * @param {number} numStops
 * @param {function(object): number[]} effectiveIndexesFn
 * @returns {number[]}
 */
function countAssignmentsPerStop(assignments, numStops, effectiveIndexesFn) {
  const counts = new Array(numStops).fill(0)
  for (const a of assignments) {
    const eff = effectiveIndexesFn(a)
    for (const i of eff) {
      if (i >= 0 && i < numStops) counts[i]++
    }
  }
  return counts
}

/**
 * Legacy rows: missing or empty servedStopIndexes => all stops.
 * @param {object} assignment
 * @param {number} numStops
 * @returns {number[]} unique sorted valid indexes
 */
function effectiveServedStopIndexes(assignment, numStops) {
  const idx = assignment.servedStopIndexes
  if (!Array.isArray(idx) || idx.length === 0) {
    return Array.from({ length: numStops }, (_, i) => i)
  }
  return [...new Set(idx.map(Number))]
    .filter(x => Number.isInteger(x) && x >= 0 && x < numStops)
    .sort((a, b) => a - b)
}

/**
 * @param {number[]} indexes
 * @param {number} numStops
 * @returns {string|null} error message
 */
function validateServedStopIndexes(indexes, numStops) {
  if (!Array.isArray(indexes) || indexes.length === 0) {
    return 'servedStopIndexes must be a non-empty array'
  }
  const seen = new Set()
  for (const i of indexes) {
    const n = Number(i)
    if (!Number.isInteger(n) || n < 0 || n >= numStops) {
      return `Invalid stop index ${i} (valid 0–${numStops - 1})`
    }
    if (seen.has(n)) return 'servedStopIndexes must not contain duplicates'
    seen.add(n)
  }
  return null
}

/**
 * @param {unknown} raw - from req.body.servedStopIndexes; null => all stops
 * @param {number} numStops
 * @returns {number[]|null} null if invalid
 */
function normalizeServedStopIndexesInput(raw, numStops) {
  if (raw == null) {
    return Array.from({ length: numStops }, (_, i) => i)
  }
  if (!Array.isArray(raw)) return null
  const set = new Set()
  for (const x of raw) {
    const n = Number(x)
    if (!Number.isInteger(n) || n < 0 || n >= numStops) return null
    set.add(n)
  }
  if (set.size === 0) return null
  return [...set].sort((a, b) => a - b)
}

/**
 * @param {object} post
 * @param {number} index
 */
function stopLabelForIndex(post, index) {
  const primary = post.destination || null
  const rest = Array.isArray(post.destinations) ? post.destinations : []
  const all = [primary, ...rest].filter(
    x =>
      x &&
      String(x.formattedAddress ?? x.address ?? '')
        .trim()
        .length > 0
  )
  if (index >= all.length || all.length === 0) {
    return `Stop ${index + 1}`
  }
  const addr = String(all[index].formattedAddress || '').trim()
  return addr || `Stop ${index + 1}`
}

module.exports = {
  canonicalDestinationStopCount,
  getDestinationQuantitiesResolved,
  parseDestinationQuantitiesInput,
  countAssignmentsPerStop,
  effectiveServedStopIndexes,
  validateServedStopIndexes,
  normalizeServedStopIndexesInput,
  stopLabelForIndex
}
