const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { loadWithMocks } = require('./helpers/loadWithMocks')
const { createMockRes } = require('./helpers/http')

const controllerPath = path.resolve(
  process.cwd(),
  'src/controllers/vehicle.controller.js'
)

const buildController = ({
  driver,
  currentVehicle = null,
  vehicleToUpdate = null,
  onUnlink
} = {}) => {
  const unlinkCalls = []
  const driverUpdates = []
  const vehicleModel = {
    findOne: query =>
      query?.ownerType
        ? Promise.resolve(null)
        : {
            select: async () => currentVehicle
          },
    findById: async id => id === vehicleToUpdate?._id ? vehicleToUpdate : null,
    create: async payload => ({
      _id: 'new-vehicle',
      ...payload,
      async populate() {
        return this
      }
    }),
    findByIdAndUpdate: (id, update) => {
      unlinkCalls.push({ id, update })
      onUnlink?.(id, update)
      if (id === vehicleToUpdate?._id) {
        return {
          populate: async () => ({
            ...vehicleToUpdate,
            ...update,
            driverId: update.driverId
              ? { _id: update.driverId, name: 'Driver', status: 'active' }
              : null
          })
        }
      }
      return Promise.resolve({ _id: id, driverId: update.driverId })
    },
    deleteOne: async () => ({ acknowledged: true })
  }

  const controller = loadWithMocks(controllerPath, {
    '../models/Vehicle': vehicleModel,
    '../models/Trip': {},
    '../models/Driver': {
      findOne: async () => driver,
      findOneAndUpdate: async (filter, update) => {
        driverUpdates.push({ filter, update })
        return { _id: filter._id, ...update.$set }
      },
      updateOne: async (filter, update) => {
        driverUpdates.push({ filter, update })
        return { modifiedCount: 1 }
      }
    },
    '../services/surepass.service': {
      verifyRcFull: async () => ({ ok: true, verified: true, status: 'verified' })
    },
    '../services/rechargeKit.service': {},
    '../services/vehicleTypeCatalog.service': {
      assertVehicleTypeAllowed: async () => ({ ok: true, name: 'Truck' })
    },
    '../middleware/permission.middleware': {
      getTransporterId: () => 'transporter-1',
      hasPermission: () => true
    },
    '../utils/vehicleValidation': {
      checkVehicleHasTripHistory: async () => false,
      getVehicleAvailabilityState: async () => ({}),
      validateIndianVehicleRegistrationFormat: value => ({
        normalized: value.replace(/\s+/g, '').toUpperCase()
      })
    },
    '../utils/cache': {
      deleteCache: async () => true,
      deleteCachePattern: async () => true,
      getCache: async () => null,
      setCache: async () => true
    }
  })

  return { controller, unlinkCalls, driverUpdates }
}

const createRequest = (overrides = {}) => ({
  body: {
    vehicleNumber: 'MH 12 AB 1234',
    vehicleType: 'Truck',
    driverId: 'driver-1',
    ...overrides
  },
  user: { id: 'transporter-1', userType: 'transporter' }
})

test('vehicle creation returns 409 with the current vehicle when driver is assigned', async () => {
  const { controller } = buildController({
    driver: {
      _id: 'driver-1',
      transporterId: 'transporter-1',
      status: 'active'
    },
    currentVehicle: {
      _id: 'vehicle-1',
      vehicleNumber: 'MH01AA1111',
      transporterId: 'transporter-1'
    }
  })
  const res = createMockRes()

  await controller.createVehicle(createRequest(), res, error => {
    throw error
  })

  assert.equal(res.statusCode, 409)
  assert.equal(res.body.success, false)
  assert.equal(res.body.code, 'DRIVER_ALREADY_ASSIGNED')
  assert.equal(res.body.message, 'Driver is already assigned to another vehicle')
  assert.deepEqual(res.body.currentVehicle, {
    id: 'vehicle-1',
    vehicleNumber: 'MH01AA1111',
    transporterId: 'transporter-1'
  })
  assert.deepEqual(res.body.data, {
    driver: {
      id: 'driver-1',
      name: null,
      mobile: null
    },
    currentVehicle: {
      id: 'vehicle-1',
      vehicleNumber: 'MH01AA1111',
      transporterId: 'transporter-1'
    }
  })
})

test('vehicle creation rejects a driver owned by another transporter', async () => {
  const { controller } = buildController({
    driver: {
      _id: 'driver-1',
      transporterId: 'transporter-2',
      status: 'active'
    }
  })
  const res = createMockRes()

  await controller.createVehicle(createRequest(), res, error => {
    throw error
  })

  assert.equal(res.statusCode, 403)
  assert.match(res.body.message, /does not belong/i)
})

test('forceReassign unlinks the old vehicle and synchronizes the driver link', async () => {
  const { controller, unlinkCalls, driverUpdates } = buildController({
    driver: {
      _id: 'driver-1',
      transporterId: 'transporter-1',
      status: 'active'
    },
    currentVehicle: {
      _id: 'vehicle-1',
      vehicleNumber: 'MH01AA1111',
      transporterId: 'transporter-1'
    }
  })
  const res = createMockRes()

  await controller.createVehicle(
    createRequest({ forceReassign: true }),
    res,
    error => {
      throw error
    }
  )

  assert.equal(res.statusCode, 201)
  assert.deepEqual(unlinkCalls[0], {
    id: 'vehicle-1',
    update: { driverId: null }
  })
  assert.deepEqual(driverUpdates, [
    { filter: { _id: 'driver-1', vehicleId: 'vehicle-1' }, update: { $set: { vehicleId: null } } },
    {
      filter: {
        _id: 'driver-1',
        transporterId: 'transporter-1',
        $or: [{ vehicleId: null }, { vehicleId: 'new-vehicle' }]
      },
      update: { $set: { vehicleId: 'new-vehicle' } }
    }
  ])
})

test('vehicle creation stores the reverse driver link', async () => {
  const { controller, driverUpdates } = buildController({
    driver: {
      _id: 'driver-1',
      transporterId: 'transporter-1',
      status: 'active'
    }
  })
  const res = createMockRes()

  await controller.createVehicle(createRequest(), res, error => {
    throw error
  })

  assert.equal(res.statusCode, 201)
  assert.deepEqual(driverUpdates, [
    {
      filter: {
        _id: 'driver-1',
        transporterId: 'transporter-1',
        $or: [{ vehicleId: null }, { vehicleId: 'new-vehicle' }]
      },
      update: { $set: { vehicleId: 'new-vehicle' } }
    }
  ])
})

test('changing a vehicle driver links the new driver and clears the old driver', async () => {
  const { controller, driverUpdates } = buildController({
    driver: {
      _id: 'driver-new',
      transporterId: 'transporter-1',
      status: 'active'
    },
    vehicleToUpdate: {
      _id: 'vehicle-to-update',
      transporterId: 'transporter-1',
      driverId: 'driver-old',
      ownerType: 'OWN'
    }
  })
  const res = createMockRes()

  await controller.updateVehicle(
    {
      params: { id: 'vehicle-to-update' },
      body: { driverId: 'driver-new' },
      user: { id: 'transporter-1', userType: 'transporter' }
    },
    res,
    error => { throw error }
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(driverUpdates, [
    {
      filter: {
        _id: 'driver-new',
        transporterId: 'transporter-1',
        $or: [{ vehicleId: null }, { vehicleId: 'vehicle-to-update' }]
      },
      update: { $set: { vehicleId: 'vehicle-to-update' } }
    },
    {
      filter: { _id: 'driver-old', vehicleId: 'vehicle-to-update' },
      update: { $set: { vehicleId: null } }
    }
  ])
})

test('removing a vehicle driver clears the reverse driver link', async () => {
  const { controller, driverUpdates } = buildController({
    vehicleToUpdate: {
      _id: 'vehicle-to-update',
      transporterId: 'transporter-1',
      driverId: 'driver-old',
      ownerType: 'OWN'
    }
  })
  const res = createMockRes()

  await controller.updateVehicle(
    {
      params: { id: 'vehicle-to-update' },
      body: { driverId: null },
      user: { id: 'transporter-1', userType: 'transporter' }
    },
    res,
    error => { throw error }
  )

  assert.equal(res.statusCode, 200)
  assert.deepEqual(driverUpdates, [
    {
      filter: { _id: 'driver-old', vehicleId: 'vehicle-to-update' },
      update: { $set: { vehicleId: null } }
    }
  ])
})

test('vehicle creation accepts cargoWeightMt of zero', async () => {
  const { controller } = buildController({
    driver: {
      _id: 'driver-1',
      transporterId: 'transporter-1',
      status: 'active'
    }
  })
  const res = createMockRes()

  await controller.createVehicle(
    createRequest({ cargoWeightMt: 0 }),
    res,
    error => {
      throw error
    }
  )

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.data.vehicle.cargoWeightMt, 0)
})

test('vehicle creation rejects negative cargoWeightMt', async () => {
  const { controller } = buildController({
    driver: {
      _id: 'driver-1',
      transporterId: 'transporter-1',
      status: 'active'
    }
  })
  const res = createMockRes()

  await controller.createVehicle(
    createRequest({ cargoWeightMt: -1 }),
    res,
    error => {
      throw error
    }
  )

  assert.equal(res.statusCode, 400)
  assert.match(res.body.message, /non-negative/i)
})
