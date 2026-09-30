/**
 * Populate Driver.vehicleId from existing Vehicle.driverId relationships.
 * Usage: node scripts/migrate-driver-vehicle-links.js
 */
const connectDB = require('../src/config/database')
const Driver = require('../src/models/Driver')
const Vehicle = require('../src/models/Vehicle')

async function migrateDriverVehicleLinks() {
  await connectDB()

  const vehicles = await Vehicle.find({ driverId: { $ne: null } })
    .select('_id driverId transporterId')
    .lean()
  const vehiclesByDriver = new Map()
  for (const vehicle of vehicles) {
    const driverId = vehicle.driverId.toString()
    const matches = vehiclesByDriver.get(driverId) || []
    matches.push(vehicle)
    vehiclesByDriver.set(driverId, matches)
  }

  const drivers = await Driver.find({
    _id: { $in: [...vehiclesByDriver.keys()] }
  }).select('_id transporterId vehicleId').lean()
  const driversById = new Map(drivers.map(driver => [driver._id.toString(), driver]))

  let updated = 0
  let skipped = 0
  for (const [driverId, matchingVehicles] of vehiclesByDriver) {
    const driver = driversById.get(driverId)
    if (!driver || matchingVehicles.length !== 1) {
      console.warn(
        `Skipping driver ${driverId}: ${!driver ? 'driver not found' : 'multiple vehicles reference this driver'}`
      )
      skipped += 1
      continue
    }

    const [vehicle] = matchingVehicles
    if (driver.transporterId?.toString() !== vehicle.transporterId?.toString()) {
      console.warn(`Skipping driver ${driverId}: transporter mismatch`)
      skipped += 1
      continue
    }
    if (driver.vehicleId && driver.vehicleId.toString() !== vehicle._id.toString()) {
      console.warn(`Skipping driver ${driverId}: vehicleId already points elsewhere`)
      skipped += 1
      continue
    }

    const result = await Driver.updateOne(
      { _id: driver._id },
      { $set: { vehicleId: vehicle._id } }
    )
    updated += result.modifiedCount || 0
  }

  console.log(`Migration complete: ${updated} drivers updated, ${skipped} skipped`)
  process.exit(0)
}

migrateDriverVehicleLinks().catch(error => {
  console.error('Migration failed:', error)
  process.exit(1)
})