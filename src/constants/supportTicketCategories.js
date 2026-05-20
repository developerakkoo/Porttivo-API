/** Support ticket category codes — keep in sync with transporter/admin clients. */
const CODES = Object.freeze({
  APP_ISSUE: 'APP_ISSUE',
  TRIP_ISSUE: 'TRIP_ISSUE',
  PAYMENT_ISSUE: 'PAYMENT_ISSUE',
  VEHICLE_ISSUE: 'VEHICLE_ISSUE',
  OTHER_ISSUE: 'OTHER_ISSUE',
  COMPLAINT_DRIVER: 'COMPLAINT_DRIVER',
  COMPLAINT_TRANSPORTER: 'COMPLAINT_TRANSPORTER',
  COMPLAINT_CUSTOMER: 'COMPLAINT_CUSTOMER',
})

const ALL_CODES = Object.freeze(Object.values(CODES))

const LABELS = Object.freeze({
  [CODES.APP_ISSUE]: 'App Related Issue',
  [CODES.TRIP_ISSUE]: 'Trip Related Issue',
  [CODES.PAYMENT_ISSUE]: 'Payment Related Issue',
  [CODES.VEHICLE_ISSUE]: 'Vehicle Related Issue',
  [CODES.OTHER_ISSUE]: 'Other Issue',
  [CODES.COMPLAINT_DRIVER]: 'Driver Complaints',
  [CODES.COMPLAINT_TRANSPORTER]: 'Transporter Complaints',
  [CODES.COMPLAINT_CUSTOMER]: 'Customer Complaints',
})

const COLORS = Object.freeze({
  [CODES.APP_ISSUE]: 'primary',
  [CODES.TRIP_ISSUE]: 'tertiary',
  [CODES.PAYMENT_ISSUE]: 'warning',
  [CODES.VEHICLE_ISSUE]: 'secondary',
  [CODES.OTHER_ISSUE]: 'medium',
  [CODES.COMPLAINT_DRIVER]: 'danger',
  [CODES.COMPLAINT_TRANSPORTER]: 'danger',
  [CODES.COMPLAINT_CUSTOMER]: 'danger',
})

const COMPLAINT_CODES = Object.freeze([
  CODES.COMPLAINT_DRIVER,
  CODES.COMPLAINT_TRANSPORTER,
  CODES.COMPLAINT_CUSTOMER,
])

const ISSUE_CODES = Object.freeze([
  CODES.APP_ISSUE,
  CODES.TRIP_ISSUE,
  CODES.PAYMENT_ISSUE,
  CODES.VEHICLE_ISSUE,
  CODES.OTHER_ISSUE,
])

function isValidCategory(code) {
  return typeof code === 'string' && ALL_CODES.includes(code)
}

function requiresDetail(code) {
  return code === CODES.OTHER_ISSUE
}

function isComplaint(code) {
  return COMPLAINT_CODES.includes(code)
}

function labelFor(code) {
  if (!code) return 'Uncategorized'
  return LABELS[code] || code
}

function buildSubject(code, categoryDetail = '') {
  const base = labelFor(code)
  if (code === CODES.OTHER_ISSUE) {
    const detail = String(categoryDetail || '').trim()
    if (detail) {
      const suffix = detail.length > 80 ? `${detail.slice(0, 77)}...` : detail
      return `Other: ${suffix}`
    }
  }
  return base
}

/**
 * @param {{ category?: string, categoryDetail?: string }} body
 * @returns {{ category: string, categoryDetail: string }}
 */
function validateCreatePayload(body = {}) {
  const category = String(body.category || '').trim()
  if (!isValidCategory(category)) {
    const err = new Error('A valid support category is required')
    err.status = 400
    throw err
  }

  let categoryDetail = String(body.categoryDetail || '').trim()
  if (requiresDetail(category)) {
    if (categoryDetail.length < 3) {
      const err = new Error(
        'Please describe your other issue (at least 3 characters)'
      )
      err.status = 400
      throw err
    }
    if (categoryDetail.length > 200) {
      categoryDetail = categoryDetail.slice(0, 200)
    }
  } else {
    categoryDetail = ''
  }

  return { category, categoryDetail }
}

/**
 * @param {{ category?: string, categoryGroup?: string }} query
 * @returns {object|undefined} Mongo filter fragment for category
 */
function buildCategoryFilter(query = {}) {
  const category = String(query.category || '').trim()
  const categoryGroup = String(query.categoryGroup || '').trim().toLowerCase()

  if (category && isValidCategory(category)) {
    return { category }
  }

  if (categoryGroup === 'complaints') {
    return { category: { $in: [...COMPLAINT_CODES] } }
  }

  if (categoryGroup === 'issues') {
    return { category: { $in: [...ISSUE_CODES] } }
  }

  return undefined
}

function getCategoriesMetadata() {
  return ALL_CODES.map(code => ({
    code,
    label: LABELS[code],
    color: COLORS[code],
    group: isComplaint(code) ? 'complaints' : 'issues',
    requiresDetail: requiresDetail(code),
  }))
}

module.exports = {
  CODES,
  ALL_CODES,
  LABELS,
  COLORS,
  COMPLAINT_CODES,
  ISSUE_CODES,
  isValidCategory,
  requiresDetail,
  isComplaint,
  labelFor,
  buildSubject,
  validateCreatePayload,
  buildCategoryFilter,
  getCategoriesMetadata,
}
