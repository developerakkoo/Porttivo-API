/**
 * Migrate legacy vehicleType strings on vehicles and marketplace posts to canonical names.
 * Usage: node scripts/migrate-vehicle-type-names.js
 */
const connectDB = require('../src/config/database');
const Vehicle = require('../src/models/Vehicle');
const VehicleRouteAvailability = require('../src/models/VehicleRouteAvailability');

const LEGACY_NAME_MAP = {
  '20FT': '20FT Trailer',
  '40FT': '40FT Trailer',
  '40FT Open': '40FT Trailer',
  Trailer: 'Low Bed Trailer',
  'Closed Body': 'Pickup',
  '22FT': '22FT Truck',
  TANKER: '20FT Reefer',
  TRUCK: '20FT Truck',
};

async function migrateCollection(Model, label) {
  let updated = 0;
  for (const [legacy, canonical] of Object.entries(LEGACY_NAME_MAP)) {
    const result = await Model.updateMany(
      { vehicleType: legacy },
      { $set: { vehicleType: canonical } }
    );
    updated += result.modifiedCount || 0;
  }
  console.log(`${label}: ${updated} documents updated`);
  return updated;
}

async function migrateVehicleTypeNames() {
  await connectDB();

  const vehicleUpdates = await migrateCollection(Vehicle, 'Vehicles');
  const postUpdates = await migrateCollection(VehicleRouteAvailability, 'Vehicle posts');

  console.log(
    `Migration complete: ${vehicleUpdates + postUpdates} total vehicleType fields updated`
  );
  process.exit(0);
}

migrateVehicleTypeNames().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
