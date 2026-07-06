const { normalizeLocationInput, validateLocationInput } = require('./location')
const { parseOptionalPricePerVehicle } = require('./vehiclePostPrice.util')

const MAX_ROUTES = 15
const MAX_FORMATTED_ADDRESS_LEN = 500

/**
 * Parse and validate the `routes` array from a request body.
 * Each route: { destination (location), exportRate?, importRate? }.
 * exportRate / importRate omitted or empty => null ("Negotiable").
 *
 * @param {*} rawRoutes
 * @returns {{ ok: true, routes: object[] } | { ok: false, message: string }}
 */
function parseRoutesInput(rawRoutes) {
  if (rawRoutes === undefined || rawRoutes === null) {
    return { ok: true, routes: [] }
  }
  if (!Array.isArray(rawRoutes)) {
    return { ok: false, message: 'routes must be an array' }
  }
  if (rawRoutes.length > MAX_ROUTES) {
    return { ok: false, message: `At most ${MAX_ROUTES} routes allowed` }
  }

  const routes = []
  for (let i = 0; i < rawRoutes.length; i++) {
    const entry = rawRoutes[i] || {}
    const dest = normalizeLocationInput(entry.destination)
    const err = validateLocationInput(dest, 'destination', {
      required: true,
      requireCoordinates: false
    })
    if (err) {
      return { ok: false, message: `route ${i + 1}: ${err}` }
    }
    const addr = String(dest.formattedAddress || '').trim()
    if (addr.length > MAX_FORMATTED_ADDRESS_LEN) {
      return {
        ok: false,
        message: `route ${i + 1}: address too long (max ${MAX_FORMATTED_ADDRESS_LEN})`
      }
    }

    const exp = parseOptionalPricePerVehicle(entry.exportRate)
    if (!exp.ok) {
      return { ok: false, message: `route ${i + 1} exportRate: ${exp.message}` }
    }
    const imp = parseOptionalPricePerVehicle(entry.importRate)
    if (!imp.ok) {
      return { ok: false, message: `route ${i + 1} importRate: ${imp.message}` }
    }

    routes.push({
      destination: dest,
      exportRate: exp.value,
      importRate: imp.value
    })
  }
  return { ok: true, routes }
}

/**
 * Lowest listed (non-null) rate across all routes and directions.
 * Drives the legacy `pricePerVehicle` "From Rs X" summary. null when every
 * rate is negotiable.
 * @param {object[]} routes
 * @returns {number|null}
 */
function minListedRate(routes) {
  let min = null
  for (const r of routes || []) {
    for (const rate of [r.exportRate, r.importRate]) {
      if (rate != null && Number.isFinite(Number(rate))) {
        const n = Number(rate)
        if (min === null || n < min) min = n
      }
    }
  }
  return min
}

/**
 * Resolve the listed rate for a chosen route + direction.
 * @param {object} post - post doc/lean with `routes`
 * @param {number} routeIndex - index into routes; -1 => negotiable catch-all
 * @param {'EXPORT'|'IMPORT'} direction
 * @returns {number|null} null => negotiable / not listed
 */
function resolveRouteDirectionRate(post, routeIndex, direction) {
  const routes = Array.isArray(post?.routes) ? post.routes : []
  if (routeIndex == null || routeIndex < 0 || routeIndex >= routes.length) {
    return null
  }
  const route = routes[routeIndex]
  const rate = direction === 'IMPORT' ? route.importRate : route.exportRate
  return rate == null ? null : Number(rate)
}

/** API-facing shape for routes on a post response. */
function routesApiFields(post) {
  const routes = Array.isArray(post?.routes) ? post.routes : []
  return {
    routes: routes.map(r => ({
      id: r._id,
      destination: r.destination || null,
      exportRate: r.exportRate == null ? null : Number(r.exportRate),
      importRate: r.importRate == null ? null : Number(r.importRate)
    })),
    acceptsOtherDestinations: !!post?.acceptsOtherDestinations
  }
}

module.exports = {
  parseRoutesInput,
  minListedRate,
  resolveRouteDirectionRate,
  routesApiFields,
  MAX_ROUTES
}
