/**
 * Backfill VehicleRouteAvailability.destinationQuantities for legacy posts.
 * Run: node scripts/migrate-destination-quantities.js
 * Requires MONGODB_URI or default from app config.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const VehicleRouteAvailability = require('../src/models/VehicleRouteAvailability')
const {
  canonicalDestinationStopCount,
  parseDestinationQuantitiesInput
} = require('../src/utils/vehiclePostDestinationQuotas')

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI
  if (!uri) {
    console.error('Set MONGODB_URI (or MONGO_URI)')
    process.exit(1)
  }
  await mongoose.connect(uri)
  const cursor = VehicleRouteAvailability.find({}).cursor()
  let updated = 0
  for await (const post of cursor) {
    const n = canonicalDestinationStopCount(post.destination, post.destinations)
    const arr = post.destinationQuantities
    const needsBackfill =
      !Array.isArray(arr) ||
      arr.length !== n ||
      arr.some(x => x == null || !Number.isFinite(Number(x)))
    if (!needsBackfill) continue
    const q = Math.max(1, Math.floor(Number(post.quantity)) || 1)
    const syntheticBody =
      n === 1 ? { destinationQuantities: [q] } : {}
    const parsed = parseDestinationQuantitiesInput(syntheticBody, n, q)
    if (!parsed.ok) continue
    post.destinationQuantities = parsed.quantities
    post.quantity = parsed.quantities.reduce((a, b) => a + b, 0)
    await post.save()
    updated++
  }
  console.log('migrate-destination-quantities: updated', updated, 'posts')
  await mongoose.disconnect()
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
