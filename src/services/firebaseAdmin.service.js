const fs = require('fs')
const path = require('path')
const {
  firebaseServiceAccountPath,
  firebaseServiceAccountJson
} = require('../config/env')

// Optional dependency: if firebase-admin isn't installed yet, push degrades to
// a no-op instead of crashing the server on require.
let admin = null
try {
  // eslint-disable-next-line global-require
  admin = require('firebase-admin')
} catch (err) {
  console.warn(
    'FCM: firebase-admin not installed — push notifications disabled. Run `npm install firebase-admin`.'
  )
}

let initialized = false
let messagingInstance = null

/** Load the service account credentials from JSON string or file path. */
function loadServiceAccount() {
  if (firebaseServiceAccountJson && firebaseServiceAccountJson.trim()) {
    try {
      return JSON.parse(firebaseServiceAccountJson)
    } catch (err) {
      console.warn(
        'FCM: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON:',
        err.message || err
      )
      return null
    }
  }

  const resolved = path.isAbsolute(firebaseServiceAccountPath)
    ? firebaseServiceAccountPath
    : path.join(process.cwd(), firebaseServiceAccountPath)

  if (!fs.existsSync(resolved)) {
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'))
  } catch (err) {
    console.warn('FCM: failed to read service account file:', err.message || err)
    return null
  }
}

/**
 * Lazily initialize firebase-admin. Never throws: if credentials are missing
 * or invalid, returns null and push simply becomes a no-op.
 */
function getMessaging() {
  if (initialized) return messagingInstance
  initialized = true

  if (!admin) return null

  try {
    const serviceAccount = loadServiceAccount()
    if (!serviceAccount) {
      console.warn(
        'FCM: no service account configured — push notifications disabled.'
      )
      return null
    }
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      })
    }
    messagingInstance = admin.messaging()
    console.log('FCM: firebase-admin initialized')
  } catch (err) {
    console.warn('FCM: initialization failed:', err.message || err)
    messagingInstance = null
  }
  return messagingInstance
}

function isPushEnabled() {
  return Boolean(getMessaging())
}

module.exports = { admin, getMessaging, isPushEnabled }
