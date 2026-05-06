const test = require('node:test')
const assert = require('node:assert/strict')
const {
  canonicalDestinationStopCount,
  parseDestinationQuantitiesInput,
  countAssignmentsPerStop,
  effectiveServedStopIndexes,
  normalizeServedStopIndexesInput,
  validateServedStopIndexes
} = require('../src/utils/vehiclePostDestinationQuotas')

test('canonicalDestinationStopCount uses at least 1', () => {
  assert.equal(canonicalDestinationStopCount(null, []), 1)
})

test('parseDestinationQuantitiesInput legacy distributes to first stop', () => {
  const r = parseDestinationQuantitiesInput({}, 3, 5)
  assert.equal(r.ok, true)
  assert.deepEqual(r.quantities, [5, 0, 0])
})

test('per-stop quota enforcement counts assignments', () => {
  const assignments = [
    { servedStopIndexes: [0] },
    { servedStopIndexes: [0, 1] }
  ]
  const counts = countAssignmentsPerStop(
    assignments,
    2,
    a => effectiveServedStopIndexes(a, 2)
  )
  assert.deepEqual(counts, [2, 1])
})

test('normalizeServedStopIndexesInput dedupes and sorts', () => {
  assert.deepEqual(normalizeServedStopIndexesInput([2, 0, 0], 3), [0, 2])
  assert.equal(normalizeServedStopIndexesInput([9], 3), null)
})

test('validateServedStopIndexes rejects dupes', () => {
  assert.match(
    validateServedStopIndexes([0, 0], 2),
    /duplicate/
  )
  assert.equal(validateServedStopIndexes([0, 1], 2), null)
})
