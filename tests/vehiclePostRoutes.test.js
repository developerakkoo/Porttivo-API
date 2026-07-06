const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseRoutesInput,
  minListedRate,
  resolveRouteDirectionRate,
  routesApiFields
} = require('../src/utils/vehiclePostRoutes.util')

test('parseRoutesInput returns empty for null/undefined', () => {
  assert.deepEqual(parseRoutesInput(undefined), { ok: true, routes: [] })
  assert.deepEqual(parseRoutesInput(null), { ok: true, routes: [] })
})

test('parseRoutesInput rejects non-array', () => {
  const r = parseRoutesInput('nope')
  assert.equal(r.ok, false)
})

test('parseRoutesInput parses destination + rates and treats empty rate as null', () => {
  const r = parseRoutesInput([
    { destination: 'Mumbai', exportRate: 45000, importRate: '' },
    { destination: { formattedAddress: 'Delhi' }, exportRate: '', importRate: 30000 }
  ])
  assert.equal(r.ok, true)
  assert.equal(r.routes.length, 2)
  assert.equal(r.routes[0].destination.formattedAddress, 'Mumbai')
  assert.equal(r.routes[0].exportRate, 45000)
  assert.equal(r.routes[0].importRate, null)
  assert.equal(r.routes[1].destination.formattedAddress, 'Delhi')
  assert.equal(r.routes[1].exportRate, null)
  assert.equal(r.routes[1].importRate, 30000)
})

test('parseRoutesInput requires a destination', () => {
  const r = parseRoutesInput([{ exportRate: 100 }])
  assert.equal(r.ok, false)
})

test('parseRoutesInput rejects negative rate', () => {
  const r = parseRoutesInput([{ destination: 'Pune', exportRate: -1 }])
  assert.equal(r.ok, false)
})

test('minListedRate finds the lowest non-null rate', () => {
  const routes = [
    { exportRate: 45000, importRate: null },
    { exportRate: null, importRate: 30000 }
  ]
  assert.equal(minListedRate(routes), 30000)
})

test('minListedRate returns null when all negotiable', () => {
  assert.equal(minListedRate([{ exportRate: null, importRate: null }]), null)
  assert.equal(minListedRate([]), null)
})

test('resolveRouteDirectionRate picks export/import by direction', () => {
  const post = {
    routes: [{ exportRate: 45000, importRate: 40000 }]
  }
  assert.equal(resolveRouteDirectionRate(post, 0, 'EXPORT'), 45000)
  assert.equal(resolveRouteDirectionRate(post, 0, 'IMPORT'), 40000)
})

test('resolveRouteDirectionRate returns null for catch-all or out-of-range', () => {
  const post = { routes: [{ exportRate: 45000, importRate: null }] }
  assert.equal(resolveRouteDirectionRate(post, -1, 'EXPORT'), null)
  assert.equal(resolveRouteDirectionRate(post, 5, 'EXPORT'), null)
  assert.equal(resolveRouteDirectionRate(post, 0, 'IMPORT'), null)
})

test('routesApiFields maps routes and acceptsOtherDestinations', () => {
  const post = {
    acceptsOtherDestinations: true,
    routes: [
      {
        _id: 'r1',
        destination: { formattedAddress: 'Chennai' },
        exportRate: 50000,
        importRate: null
      }
    ]
  }
  const out = routesApiFields(post)
  assert.equal(out.acceptsOtherDestinations, true)
  assert.equal(out.routes.length, 1)
  assert.equal(out.routes[0].destination.formattedAddress, 'Chennai')
  assert.equal(out.routes[0].exportRate, 50000)
  assert.equal(out.routes[0].importRate, null)
})
