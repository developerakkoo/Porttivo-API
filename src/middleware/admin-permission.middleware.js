/**
 * Require admin to have a specific permission.
 * Use after authenticate middleware. req.user.permissions must be set (object with canManageTrips, etc.)
 * @param {string} permission - e.g. 'canManageTrips', 'canManageUsers'
 */
const requireAdminPermission = (permission) => (req, res, next) => {
  if (req.user?.userType !== 'admin') return next();
  const perms = req.user.permissions || {};
  if (perms[permission] !== false) return next();
  return res.status(403).json({
    success: false,
    message: `Access denied. Required permission: ${permission}`,
  });
};

module.exports = { requireAdminPermission };
