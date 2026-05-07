/**
 * VehicleRouteAssignment rows with isReleased !== true still "occupy" listing slots
 * and appear as buyer-selectable vehicles.
 */
function liveAssignmentFilter(base = {}) {
  return { ...base, isReleased: { $ne: true } }
}

module.exports = { liveAssignmentFilter }
