const AuditLog = require('../models/AuditLog');

const SENSITIVE_KEYS = ['password', 'otp', 'pin', 'refreshToken', 'accessToken', 'token'];

const USER_TYPE_MAP = {
  transporter: 'TRANSPORTER',
  driver: 'DRIVER',
  'pump_owner': 'PUMP_OWNER',
  'pump_staff': 'PUMP_STAFF',
  admin: 'ADMIN',
  customer: 'CUSTOMER',
  'company-user': 'COMPANY_USER',
};

function sanitizeBody(body) {
  if (!body || typeof body !== 'object') return body;
  const sanitized = { ...body };
  for (const key of SENSITIVE_KEYS) {
    if (key in sanitized) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}

function mapUserType(userType) {
  if (!userType) return 'SYSTEM';
  const normalized = userType.toLowerCase().replace(/\s/g, '-');
  return USER_TYPE_MAP[normalized] || 'SYSTEM';
}

/**
 * Log a system action to the audit log. Fire-and-forget, non-blocking.
 * @param {Object} params
 * @param {string} [params.userId] - User ID (ObjectId string)
 * @param {string} [params.userType] - Auth userType (transporter, driver, etc.)
 * @param {string} params.action - Action (CREATE, UPDATE, etc.)
 * @param {string} params.resource - Resource (TRIP, USER, etc.)
 * @param {string} [params.resourceId] - Resource ID
 * @param {string} params.result - SUCCESS, FAILURE, ERROR
 * @param {string} [params.ipAddress]
 * @param {string} [params.userAgent]
 * @param {string} [params.requestMethod]
 * @param {string} [params.requestPath]
 * @param {Object} [params.requestBody]
 * @param {number} [params.responseStatus]
 * @param {string} [params.errorMessage]
 * @param {Object} [params.metadata]
 */
function logSystemAction(params) {
  setImmediate(() => {
    AuditLog.create({
      userId: params.userId || null,
      userType: mapUserType(params.userType || 'SYSTEM'),
      action: params.action || 'UNKNOWN',
      resource: params.resource || 'UNKNOWN',
      resourceId: params.resourceId || null,
      result: params.result || 'SUCCESS',
      ipAddress: params.ipAddress || null,
      userAgent: params.userAgent || null,
      requestMethod: params.requestMethod || null,
      requestPath: params.requestPath || null,
      requestBody: params.requestBody ? sanitizeBody(params.requestBody) : undefined,
      responseStatus: params.responseStatus || null,
      errorMessage: params.errorMessage || null,
      metadata: params.metadata || {},
    }).catch((err) => {
      if (process.env.NODE_ENV === 'development') {
        console.error('Audit log failed:', err.message);
      }
    });
  });
}

module.exports = {
  logSystemAction,
  sanitizeBody,
  mapUserType,
};
