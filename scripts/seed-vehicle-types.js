/**
 * Idempotent seed for default vehicle types.
 * Usage: node scripts/seed-vehicle-types.js
 */
const connectDB = require('../src/config/database');
const VehicleType = require('../src/models/VehicleType');

const DEFAULT_TYPES = [
  { name: '20FT Trailer', code: '20FT_TRAILER', sortOrder: 1 },
  { name: '40FT Trailer', code: '40FT_TRAILER', sortOrder: 2 },
  { name: '20FT Reefer', code: '20FT_REEFER', sortOrder: 3 },
  { name: '40FT Reefer', code: '40FT_REEFER', sortOrder: 4 },
  { name: 'Low Bed Trailer', code: 'LOW_BED_TRAILER', sortOrder: 5 },
  { name: 'ODC Trailer', code: 'ODC_TRAILER', sortOrder: 6 },
  { name: 'Pickup', code: 'PICKUP', sortOrder: 7 },
  { name: 'Tata Ace', code: 'TATA_ACE', sortOrder: 8 },
  { name: '14FT Truck', code: '14FT_TRUCK', sortOrder: 9 },
  { name: '17FT Truck', code: '17FT_TRUCK', sortOrder: 10 },
  { name: '20FT Truck', code: '20FT_TRUCK', sortOrder: 11 },
  { name: '22FT Truck', code: '22FT_TRUCK', sortOrder: 12 },
  { name: '24FT Truck', code: '24FT_TRUCK', sortOrder: 13 },
  { name: '32FT Single Axle', code: '32FT_SINGLE_AXLE', sortOrder: 14 },
  { name: '32FT Multi Axle', code: '32FT_MULTI_AXLE', sortOrder: 15 },
  { name: '20 FT Container 2 Axle', code: '20FT_CONTAINER_2_AXLE', sortOrder: 16 },
  { name: '20 FT Container 3 Axle', code: '20FT_CONTAINER_3_AXLE', sortOrder: 17 },
  { name: '40 FT Container 2 Axle', code: '40FT_CONTAINER_2_AXLE', sortOrder: 18 },
  { name: '40 FT Container 3 Axle', code: '40FT_CONTAINER_3_AXLE', sortOrder: 19 },
  { name: '20 FT Reefer 2 Axle', code: '20FT_REEFER_2_AXLE', sortOrder: 20 },
  { name: '20 FT Reefer 3 Axle', code: '20FT_REEFER_3_AXLE', sortOrder: 21 },
  { name: '40 FT Reefer 2 Axle', code: '40FT_REEFER_2_AXLE', sortOrder: 22 },
  { name: '40 FT Reefer 3 Axle', code: '40FT_REEFER_3_AXLE', sortOrder: 23 },
  { name: '20 FT Closed Body Single Axle', code: '20FT_CLOSED_BODY_SINGLE_AXLE', sortOrder: 24 },
  { name: '20 FT Closed Body 2 Axle', code: '20FT_CLOSED_BODY_2_AXLE', sortOrder: 25 },
  { name: '20 FT Closed Body 3 Axle', code: '20FT_CLOSED_BODY_3_AXLE', sortOrder: 26 },
];

async function seedVehicleTypes() {
  await connectDB();

  let created = 0;
  let skipped = 0;

  for (const item of DEFAULT_TYPES) {
    const existing = await VehicleType.findOne({ name: item.name });
    if (existing) {
      skipped += 1;
      continue;
    }
    await VehicleType.create({
      name: item.name,
      code: item.code,
      sortOrder: item.sortOrder,
      isActive: true,
    });
    created += 1;
  }

  console.log(`Vehicle types seed complete: ${created} created, ${skipped} skipped`);
  process.exit(0);
}

seedVehicleTypes().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
