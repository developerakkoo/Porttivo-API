const Notification = require('../models/Notification')
const DeviceToken = require('../models/DeviceToken')
const { getMessaging } = require('./firebaseAdmin.service')

/** FCM data payload values must be strings. */
function stringifyData(data = {}) {
  const out = {}
  for (const [k, v] of Object.entries(data)) {
    if (v === null || v === undefined) continue
    out[k] = typeof v === 'string' ? v : String(v)
  }
  return out
}

/**
 * Send an FCM push to every registered device of a user. Best-effort: prunes
 * dead tokens and never throws (returns a small summary instead).
 */
async function sendToUser(userId, userType, { title, body, data = {} }) {
  if (!userId) return { sent: 0, skipped: true }

  const messaging = getMessaging()
  if (!messaging) return { sent: 0, disabled: true }

  const rows = await DeviceToken.find({
    userId,
    userType: userType || 'TRANSPORTER'
  })
    .select('token')
    .lean()

  const tokens = rows.map((r) => r.token).filter(Boolean)
  if (tokens.length === 0) return { sent: 0, noTokens: true }

  const message = {
    tokens,
    notification: { title: title || 'Porttivo', body: body || '' },
    data: stringifyData(data),
    android: {
      priority: 'high',
      notification: { channelId: 'porttivo_default', sound: 'default' }
    },
    apns: {
      payload: { aps: { sound: 'default' } }
    }
  }

  try {
    const resp = await messaging.sendEachForMulticast(message)
    // Prune invalid/unregistered tokens.
    const toDelete = []
    resp.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || ''
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          toDelete.push(tokens[i])
        }
      }
    })
    if (toDelete.length > 0) {
      await DeviceToken.deleteMany({ token: { $in: toDelete } })
    }
    return { sent: resp.successCount, failed: resp.failureCount }
  } catch (err) {
    console.warn('FCM sendToUser failed:', err.message || err)
    return { sent: 0, error: true }
  }
}

/**
 * Unified notification helper: persists an in-app Notification, emits the
 * `notification:new` socket event, and sends an FCM push — all best-effort so a
 * failure in any channel never breaks the calling request.
 *
 * @returns the created Notification document (or null).
 */
async function notifyUser({
  userId,
  userType = 'TRANSPORTER',
  type,
  title,
  message,
  data = {},
  priority = 'medium'
}) {
  if (!userId) return null

  let notification = null
  try {
    notification = await Notification.create({
      userId,
      userType,
      type,
      title,
      message,
      data,
      priority
    })
  } catch (err) {
    console.warn('notifyUser: Notification.create failed:', err.message || err)
  }

  // Real-time socket ping so the in-app inbox refreshes immediately.
  try {
    const { getIO } = require('./socket.service')
    const io = getIO()
    const room =
      userType === 'DRIVER'
        ? `driver:${userId}`
        : userType === 'CUSTOMER'
          ? `customer:${userId}`
          : `transporter:${userId}`
    io.to(room).emit('notification:new', {
      id: notification?._id,
      type,
      title,
      message,
      data
    })
  } catch (err) {
    // socket not ready — non-fatal
  }

  // FCM push (background/terminated delivery).
  try {
    await sendToUser(userId, userType, { title, body: message, data })
  } catch (err) {
    console.warn('notifyUser: push failed:', err.message || err)
  }

  return notification
}

/** Fan-out notifyUser to many users of the same type. */
async function notifyUsers(userIds = [], payload) {
  const unique = [...new Set((userIds || []).map((id) => String(id)))]
  await Promise.all(unique.map((userId) => notifyUser({ ...payload, userId })))
  return unique.length
}

module.exports = { sendToUser, notifyUser, notifyUsers }
