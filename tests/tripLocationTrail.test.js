const test = require('node:test')
const assert = require('node:assert/strict')

const {
  decimatePoints,
  TRACKABLE_STATUSES,
} = require('../src/services/tripLocationTrail.service')
const { TRIP_STATUS } = require('../src/utils/tripState')

test('TRACKABLE_STATUSES includes active paused pod pending', () => {
  assert.ok(TRACKABLE_STATUSES.includes(TRIP_STATUS.ACTIVE))
  assert.ok(TRACKABLE_STATUSES.includes(TRIP_STATUS.PAUSED))
  assert.ok(TRACKABLE_STATUSES.includes(TRIP_STATUS.POD_PENDING))
})

test('decimatePoints keeps first and last', () => {
  const points = Array.from({ length: 100 }, (_, i) => ({ i }))
  const out = decimatePoints(points, 10)
  assert.equal(out.length, 10)
  assert.deepEqual(out[0], points[0])
  assert.deepEqual(out[9], points[99])
})

test('decimatePoints returns same array when under cap', () => {
  const points = [{ a: 1 }, { a: 2 }]
  assert.equal(decimatePoints(points, 10), points)
})
