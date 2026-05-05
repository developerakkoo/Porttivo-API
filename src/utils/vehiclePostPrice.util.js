const MAX_PRICE_PER_VEHICLE = 1e9

const isEmptyPriceInput = (value) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '')

/**
 * Optional listing price per vehicle (INR). Empty input => null.
 * @param {*} value - raw body field
 * @returns {{ ok: true, value: null } | { ok: true, value: number } | { ok: false, message: string }}
 */
const parseOptionalPricePerVehicle = (value) => {
  if (isEmptyPriceInput(value)) {
    return { ok: true, value: null }
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) {
    return { ok: false, message: 'pricePerVehicle must be a valid number' }
  }
  if (n < 0) {
    return { ok: false, message: 'pricePerVehicle cannot be negative' }
  }
  if (n > MAX_PRICE_PER_VEHICLE) {
    return {
      ok: false,
      message: `pricePerVehicle cannot exceed ${MAX_PRICE_PER_VEHICLE}`,
    }
  }
  return { ok: true, value: n }
}

module.exports = {
  parseOptionalPricePerVehicle,
  MAX_PRICE_PER_VEHICLE,
}
