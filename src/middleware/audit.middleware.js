const { logSystemAction } = require('../services/audit.service');

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

function deriveResourceAndAction(method, path) {
  const pathOnly = (path || '').split('?')[0];
  const normalized = pathOnly.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  if (normalized.length === 0) return { resource: 'UNKNOWN', action: 'UNKNOWN' };

  const base = normalized[0];
  const sub = normalized[2]; // e.g. trips/:id/pod -> pod

  const resourceMap = {
    trips: 'TRIP',
    auth: 'AUTH',
    transporters: 'TRANSPORTER',
    drivers: 'DRIVER',
    vehicles: 'VEHICLE',
    'fuel-cards': 'FUEL_CARD',
    fuel: 'FUEL',
    'company-users': 'COMPANY_USER',
    'pump-owners': 'PUMP_OWNER',
    'pump-staff': 'PUMP_STAFF',
    admins: 'ADMIN',
    admin: 'ADMIN',
    wallets: 'WALLET',
    settlements: 'SETTLEMENT',
    notifications: 'NOTIFICATION',
  };

  const resource = resourceMap[base] || base.toUpperCase().replace(/-/g, '_');

  let action = 'UNKNOWN';
  if (method === 'POST') {
    if (sub === 'pod') action = 'POD_UPLOAD';
    else if (sub === 'approve') action = 'APPROVE';
    else if (base === 'auth') action = 'LOGIN';
    else action = 'CREATE';
  } else if (method === 'PUT' || method === 'PATCH') {
    if (sub === 'cancel') action = 'CANCEL';
    else if (sub === 'start') action = 'START';
    else if (sub === 'complete') action = 'COMPLETE';
    else if (sub === 'pod' && normalized[3] === 'approve') action = 'POD_APPROVE';
    else if (base === 'auth') action = 'REFRESH';
    else action = 'UPDATE';
  } else if (method === 'DELETE') {
    action = 'DELETE';
  }

  return { resource, action };
}

function extractResourceId(path) {
  const match = (path || '').match(/\/([a-fA-F0-9]{24})(?:\/|$)/);
  return match ? match[1] : null;
}

function captureAndLog(req, res, body) {
  if (!req.user) return;

  const status = res.statusCode;
  const result = status >= 200 && status < 300 ? 'SUCCESS' : status >= 500 ? 'ERROR' : 'FAILURE';
  const { resource, action } = deriveResourceAndAction(req.method, req.path || req.url);
  const resourceId = extractResourceId(req.path || req.url);
  const bodyObj = typeof body === 'object' ? body : {};

  logSystemAction({
    userId: req.user.id,
    userType: req.user.userType,
    action,
    resource,
    resourceId,
    result,
    ipAddress: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for']?.split(',')[0]?.trim(),
    userAgent: req.headers['user-agent'],
    requestMethod: req.method,
    requestPath: req.path || req.originalUrl || req.url,
    requestBody: req.body,
    responseStatus: status,
    errorMessage: bodyObj?.message || (result !== 'SUCCESS' ? bodyObj?.message : null),
  });
}

function auditRequest(req, res, next) {
  if (!MUTATING_METHODS.includes(req.method)) {
    return next();
  }

  const originalJson = res.json.bind(res);
  const originalSend = res.send.bind(res);

  res.json = function (body) {
    res.json = originalJson;
    res.send = originalSend;
    captureAndLog(req, res, body);
    return originalJson(body);
  };

  res.send = function (body) {
    res.json = originalJson;
    res.send = originalSend;
    captureAndLog(req, res, body);
    return originalSend(body);
  };

  next();
}

module.exports = {
  auditRequest,
};
