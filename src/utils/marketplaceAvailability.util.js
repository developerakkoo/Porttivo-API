const VehicleBooking = require('../models/VehicleBooking')
const VehicleRouteAssignment = require('../models/VehicleRouteAssignment')
const { liveAssignmentFilter } = require('./liveVehicleAssignment')

const CONFIRMED_BOOKING_STATUS = 'CONFIRMED'

function assignmentIdString(assignment) {
  if (!assignment?._id) return null
  return assignment._id.toString()
}

/**
 * Confirmed booking assignment ids for the given posts (Set of strings).
 */
async function getConfirmedAssignmentIds(postIds) {
  if (!postIds?.length) return new Set()

  const bookings = await VehicleBooking.find({
    postId: { $in: postIds },
    status: CONFIRMED_BOOKING_STATUS
  })
    .select('assignmentId')
    .lean()

  const ids = new Set()
  for (const booking of bookings) {
    if (booking.assignmentId) {
      ids.add(booking.assignmentId.toString())
    }
  }
  return ids
}

function filterBookableAssignments(assignments, confirmedAssignmentIds) {
  return (assignments || []).filter(assignment => {
    if (assignment.isReleased === true) return false
    const id = assignmentIdString(assignment)
    return id != null && !confirmedAssignmentIds.has(id)
  })
}

function hasBookableInventory(assignments, confirmedAssignmentIds) {
  return filterBookableAssignments(assignments, confirmedAssignmentIds).length > 0
}

/**
 * Count active posts matching [query] that still have at least one bookable vehicle.
 */
async function countPostsWithBookableInventory(VehicleRouteAvailability, query) {
  const posts = await VehicleRouteAvailability.find(query).select('_id').lean()
  if (!posts.length) return 0

  const postIds = posts.map(p => p._id)
  const confirmedAssignmentIds = await getConfirmedAssignmentIds(postIds)

  const assignments = await VehicleRouteAssignment.find(
    liveAssignmentFilter({ postId: { $in: postIds } })
  )
    .select('postId isReleased')
    .lean()

  const assignmentsByPost = assignments.reduce((acc, assignment) => {
    const key = assignment.postId.toString()
    acc[key] = acc[key] || []
    acc[key].push(assignment)
    return acc
  }, {})

  let count = 0
  for (const post of posts) {
    const key = post._id.toString()
    if (
      hasBookableInventory(
        assignmentsByPost[key] || [],
        confirmedAssignmentIds
      )
    ) {
      count += 1
    }
  }
  return count
}

module.exports = {
  CONFIRMED_BOOKING_STATUS,
  getConfirmedAssignmentIds,
  filterBookableAssignments,
  hasBookableInventory,
  countPostsWithBookableInventory
}
