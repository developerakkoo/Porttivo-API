const AdminAuditLog = require('../models/AdminAuditLog');

const logAdminAction = async ({ adminId, action, entityType, entityId = null, metadata = {} }) =>
  AdminAuditLog.create({
    adminId,
    action,
    entityType,
    entityId,
    metadata,
  });

module.exports = {
  logAdminAction,
};
