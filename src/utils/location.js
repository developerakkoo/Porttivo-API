const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const parseMaybeJson = value => {
  if (typeof value !== 'string') return value

  const trimmed = value.trim()
  if (!trimmed) return value

  if (
    !trimmed.startsWith('{') &&
    !trimmed.startsWith('[') &&
    trimmed !== 'null' &&
    trimmed !== 'undefined'
  ) {
    return value
  }

  try {
    return JSON.parse(trimmed)
  } catch (error) {
    return value
  }
}

const toFiniteNumber = value => {
  if (value === '' || value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

const normalizeCoordinates = value => {
  if (!value) return []

  if (Array.isArray(value)) {
    if (value.length !== 2) return []
    const longitude = toFiniteNumber(value[0])
    const latitude = toFiniteNumber(value[1])
    return longitude === null || latitude === null ? [] : [longitude, latitude]
  }

  if (isPlainObject(value)) {
    const longitude = toFiniteNumber(
      value.longitude ?? value.lng ?? value.lon ?? value.x
    )
    const latitude = toFiniteNumber(value.latitude ?? value.lat ?? value.y)
    return longitude === null || latitude === null ? [] : [longitude, latitude]
  }

  return []
}

const normalizeLocationInput = value => {
  const parsedValue = parseMaybeJson(value)

  if (parsedValue === null || parsedValue === undefined || parsedValue === '') {
    return parsedValue
  }

  if (typeof parsedValue === 'string') {
    if (!parsedValue.trim()) return null
    return {
      type: 'Point',
      formattedAddress: parsedValue.trim(),
      coordinates: []
    }
  }

  if (!isPlainObject(parsedValue)) {
    return parsedValue
  }

  const formattedAddress = (
    parsedValue.formattedAddress ??
    parsedValue.address ??
    parsedValue.name ??
    ''
  ).toString().trim()

  return {
    type: parsedValue.type || 'Point',
    coordinates: normalizeCoordinates(
      parsedValue.coordinates ?? parsedValue.location ?? parsedValue
    ),
    formattedAddress,
    placeId: parsedValue.placeId?.toString().trim() || null,
    addressLine1: parsedValue.addressLine1?.toString().trim() || null,
    locality: parsedValue.locality?.toString().trim() || null,
    administrativeArea: parsedValue.administrativeArea?.toString().trim() || null,
    postalCode: parsedValue.postalCode?.toString().trim() || null,
    countryCode: parsedValue.countryCode?.toString().trim()?.toUpperCase() || null,
    name: parsedValue.name?.toString().trim() || null,
    provider: parsedValue.provider || null,
    resolvedAt: parsedValue.resolvedAt ? new Date(parsedValue.resolvedAt) : null
  }
}

const validateLocationInput = (
  value,
  label,
  { required = false, requireCoordinates = false } = {}
) => {
  const location = normalizeLocationInput(value)

  if (
    location === null ||
    location === undefined ||
    (typeof location === 'string' && location.trim() === '')
  ) {
    return required ? `${label} is required` : null
  }

  if (typeof location === 'string') {
    return `${label} must include a formattedAddress`
  }

  if (!location.formattedAddress) {
    return `${label}.formattedAddress is required`
  }

  if (Array.isArray(location.coordinates) && location.coordinates.length > 0) {
    const [longitude, latitude] = location.coordinates
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return `${label}.coordinates must be [longitude, latitude]`
    }
  }

  if (requireCoordinates) {
    const coords = location.coordinates
    if (!Array.isArray(coords) || coords.length !== 2) {
      return `${label} must include coordinates as [longitude, latitude]`
    }
    const [longitude, latitude] = coords
    if (
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitude) ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      return `${label}.coordinates must be [longitude, latitude]`
    }
  }

  return null
}

module.exports = {
  normalizeLocationInput,
  validateLocationInput
}
