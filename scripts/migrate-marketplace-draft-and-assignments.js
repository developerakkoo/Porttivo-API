/**
 * 1) Demote active marketplace posts with zero VehicleRouteAssignment rows to `draft`
 *    so they do not appear in search until the seller attaches fleet.
 * 2) Replace strict unique index on (postId, vehicleId) with a partial unique index
 *    so the same vehicle can be re-listed after `isReleased: true`.
 *
 * Run: node scripts/migrate-marketplace-draft-and-assignments.js
 * Requires MONGODB_URI or MONGO_URI (see dotenv).
 */
require('dotenv').config()
const mongoose = require('mongoose')
const VehicleRouteAvailability = require('../src/models/VehicleRouteAvailability')
const VehicleRouteAssignment = require('../src/models/VehicleRouteAssignment')

async function run() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI
  if (!uri) {
    console.error('Set MONGODB_URI (or MONGO_URI)')
    process.exit(1)
  }
  await mongoose.connect(uri)

  const coll = mongoose.connection.collection('vehiclerouteassignments')
  try {
    await coll.dropIndex('postId_1_vehicleId_1')
    console.log('Dropped index postId_1_vehicleId_1')
  } catch (e) {
    if (e.code !== 27 && e.codeName !== 'IndexNotFound') {
      console.warn('dropIndex:', e.message || e)
    }
  }
  await coll.createIndex(
    { postId: 1, vehicleId: 1 },
    {
      unique: true,
      partialFilterExpression: { isReleased: { $ne: true } },
      name: 'postId_1_vehicleId_1_live_unique'
    }
  )
  console.log('Ensured partial unique index postId_1_vehicleId_1_live_unique')

  let demoted = 0
  const activeCursor = VehicleRouteAvailability.find({
    status: 'active'
  }).cursor()

  for await (const post of activeCursor) {
    const n = await VehicleRouteAssignment.countDocuments({
      postId: post._id
    })
    if (n === 0) {
      post.status = 'draft'
      await post.save()
      demoted++
    }
  }

  console.log(
    'migrate-marketplace-draft-and-assignments: demoted',
    demoted,
    'active posts with no assignments to draft'
  )
  await mongoose.disconnect()
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
