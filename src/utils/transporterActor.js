/**
 * Transporter id for VehicleBooking / TransporterMessage (refs are always Transporter).
 * Company users act as their parent transporter.
 */
function getTransporterActorId(user) {
  if (!user) return null
  if (user.userType === 'transporter') {
    return user.id?.toString?.() ?? String(user.id)
  }
  if (user.userType === 'company-user' && user.transporterId) {
    return user.transporterId.toString?.() ?? String(user.transporterId)
  }
  return null
}

module.exports = { getTransporterActorId }
