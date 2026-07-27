const DeviceToken = require('../models/DeviceToken')

/** Map JWT userType to the DeviceToken userType enum. */
function normalizeUserType(userType) {
  const map = {
    transporter: 'TRANSPORTER',
    'company-user': 'TRANSPORTER',
    driver: 'DRIVER',
    pump_owner: 'PUMP_OWNER',
    pump_staff: 'PUMP_STAFF',
    admin: 'ADMIN',
    customer: 'CUSTOMER'
  }
  return map[userType] || 'TRANSPORTER'
}

/**
 * Resolve the id used to scope notifications. Company users share their parent
 * transporter's notification stream.
 */
function resolveUserId(user) {
  if (user.userType === 'company-user' && user.transporterId) {
    return user.transporterId
  }
  return user.id
}

// POST /api/devices/register  { token, platform }
const registerDevice = async (req, res, next) => {
  try {
    const { token, platform } = req.body
    if (!token || !String(token).trim()) {
      return res
        .status(400)
        .json({ success: false, message: 'token is required' })
    }

    const userId = resolveUserId(req.user)
    const userType = normalizeUserType(req.user.userType)

    // Upsert by token so re-registration (or reassignment across users) is clean.
    await DeviceToken.findOneAndUpdate(
      { token: String(token).trim() },
      {
        token: String(token).trim(),
        userId,
        userType,
        platform: ['android', 'ios', 'web'].includes(platform)
          ? platform
          : 'unknown',
        lastSeenAt: new Date()
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )

    return res.status(200).json({ success: true, message: 'Device registered' })
  } catch (error) {
    next(error)
  }
}

// DELETE /api/devices/token  { token }
const unregisterDevice = async (req, res, next) => {
  try {
    const token = req.body?.token || req.query?.token
    if (!token) {
      return res
        .status(400)
        .json({ success: false, message: 'token is required' })
    }
    await DeviceToken.deleteOne({ token: String(token).trim() })
    return res
      .status(200)
      .json({ success: true, message: 'Device unregistered' })
  } catch (error) {
    next(error)
  }
}

module.exports = { registerDevice, unregisterDevice }
