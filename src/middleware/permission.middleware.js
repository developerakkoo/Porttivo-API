/**
 * Permission middleware for checking user permissions
 * Transporters (main account) have all permissions
 * Company users have permissions based on their assigned permissions array
 */

/**
 * Require a specific permission
 * @param {string} permission - The permission to check
 */
const requirePermission = (permission) => {
  return (req, res, next) => {
    // Transporters have all permissions
    if (req.user.userType === 'transporter') {
      return next();
    }

    // Admins have all permissions
    if (req.user.userType === 'admin') {
      return next();
    }

    // For company users, check permissions
    if (req.user.userType === 'company-user') {
      const permissions = req.user.permissions || [];
      if (permissions.includes(permission)) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: `Access denied. Required permission: ${permission}`,
      });
    }

    // Other user types don't have permission system
    return res.status(403).json({
      success: false,
      message: 'Access denied. Invalid user type for permission check.',
    });
  };
};

/**
 * Require any of the specified permissions
 * @param {string[]} permissions - Array of permissions (user needs at least one)
 */
const requireAnyPermission = (permissions) => {
  return (req, res, next) => {
    // Transporters have all permissions
    if (req.user.userType === 'transporter') {
      return next();
    }

    // Admins have all permissions
    if (req.user.userType === 'admin') {
      return next();
    }

    // For company users, check if they have any of the required permissions
    if (req.user.userType === 'company-user') {
      const userPermissions = req.user.permissions || [];
      const hasAnyPermission = permissions.some((permission) =>
        userPermissions.includes(permission)
      );

      if (hasAnyPermission) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: `Access denied. Required one of the following permissions: ${permissions.join(', ')}`,
      });
    }

    // Other user types don't have permission system
    return res.status(403).json({
      success: false,
      message: 'Access denied. Invalid user type for permission check.',
    });
  };
};

/**
 * Require all of the specified permissions
 * @param {string[]} permissions - Array of permissions (user needs all)
 */
const requireAllPermissions = (permissions) => {
  return (req, res, next) => {
    // Transporters have all permissions
    if (req.user.userType === 'transporter') {
      return next();
    }

    // Admins have all permissions
    if (req.user.userType === 'admin') {
      return next();
    }

    // For company users, check if they have all required permissions
    if (req.user.userType === 'company-user') {
      const userPermissions = req.user.permissions || [];
      const hasAllPermissions = permissions.every((permission) =>
        userPermissions.includes(permission)
      );

      if (hasAllPermissions) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: `Access denied. Required all of the following permissions: ${permissions.join(', ')}`,
      });
    }

    // Other user types don't have permission system
    return res.status(403).json({
      success: false,
      message: 'Access denied. Invalid user type for permission check.',
    });
  };
};

/**
 * Helper function to check if user has permission (for use in controllers)
 * @param {object} user - req.user object
 * @param {string} permission - Permission to check
 * @returns {boolean}
 */
const hasPermission = (user, permission) => {
  if (user.userType === 'transporter' || user.userType === 'admin') {
    return true;
  }

  if (user.userType === 'company-user') {
    const permissions = user.permissions || [];
    return permissions.includes(permission);
  }

  return false;
};

/**
 * Helper function to get transporter ID from user (for filtering data)
 * @param {object} user - req.user object
 * @returns {string|null} - Transporter ID or null
 */
const getTransporterId = (user) => {
  if (user.userType === 'transporter') {
    return user.id;
  }

  if (user.userType === 'company-user') {
    return user.transporterId;
  }

  return null;
};

module.exports = {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  hasPermission,
  getTransporterId,
};
