const AdminAuditLog = require('../models/AdminAuditLog');
const { deleteCachePattern } = require('../utils/cache');
const logger = require('../utils/logger');

const logAdminAction = async ({ adminId, action, entityType, entityId = null, metadata = {} }) => {
  const result = await AdminAuditLog.create({
    adminId,
    action,
    entityType,
    entityId,
    metadata,
  });
  const patterns = ['admin:audit-logs:*', 'admin:system-audit-logs:*'];
  const results = await Promise.all(patterns.map((pattern) => deleteCachePattern(pattern)));
  logger.info('CACHE INVALIDATION', { scope: 'ADMIN', patterns, skipped: results.some((item) => !item) });
  return result;
};

module.exports = {
  logAdminAction,
};
