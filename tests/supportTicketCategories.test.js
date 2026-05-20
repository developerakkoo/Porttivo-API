const test = require('node:test')
const assert = require('node:assert/strict')

const {
  CODES,
  isValidCategory,
  validateCreatePayload,
  buildCategoryFilter,
  buildSubject,
  requiresDetail,
  getCategoriesMetadata,
} = require('../src/constants/supportTicketCategories')

test('isValidCategory accepts known codes', () => {
  assert.equal(isValidCategory(CODES.APP_ISSUE), true)
  assert.equal(isValidCategory(CODES.COMPLAINT_DRIVER), true)
  assert.equal(isValidCategory(''), false)
  assert.equal(isValidCategory('INVALID'), false)
})

test('validateCreatePayload requires valid category', () => {
  assert.throws(
    () => validateCreatePayload({ category: '' }),
    (e) => e.status === 400
  )
  assert.throws(
    () => validateCreatePayload({ category: 'FOO' }),
    (e) => e.status === 400
  )
})

test('validateCreatePayload requires categoryDetail for OTHER_ISSUE', () => {
  assert.throws(
    () => validateCreatePayload({ category: CODES.OTHER_ISSUE }),
    (e) => e.status === 400
  )
  assert.throws(
    () => validateCreatePayload({ category: CODES.OTHER_ISSUE, categoryDetail: 'ab' }),
    (e) => e.status === 400
  )
  const ok = validateCreatePayload({
    category: CODES.OTHER_ISSUE,
    categoryDetail: 'Billing mismatch',
  })
  assert.equal(ok.category, CODES.OTHER_ISSUE)
  assert.equal(ok.categoryDetail, 'Billing mismatch')
})

test('validateCreatePayload clears detail for non-other categories', () => {
  const ok = validateCreatePayload({
    category: CODES.TRIP_ISSUE,
    categoryDetail: 'ignored',
  })
  assert.equal(ok.categoryDetail, '')
})

test('buildSubject for OTHER_ISSUE includes detail', () => {
  assert.equal(
    buildSubject(CODES.OTHER_ISSUE, 'Late payment'),
    'Other: Late payment'
  )
})

test('buildCategoryFilter supports category and complaints group', () => {
  assert.deepEqual(buildCategoryFilter({ category: CODES.APP_ISSUE }), {
    category: CODES.APP_ISSUE,
  })
  assert.deepEqual(buildCategoryFilter({ categoryGroup: 'complaints' }), {
    category: {
      $in: [
        CODES.COMPLAINT_DRIVER,
        CODES.COMPLAINT_TRANSPORTER,
        CODES.COMPLAINT_CUSTOMER,
      ],
    },
  })
  assert.equal(buildCategoryFilter({}), undefined)
})

test('getCategoriesMetadata returns all codes', () => {
  const meta = getCategoriesMetadata()
  assert.equal(meta.length, 8)
  assert.ok(meta.every((m) => m.code && m.label && m.color))
  assert.equal(requiresDetail(CODES.OTHER_ISSUE), true)
})
