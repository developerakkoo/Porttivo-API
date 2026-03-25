const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  getProfile,
  updateProfile,
  getDashboardStats,
  getSystemAnalytics,
  listAdminTrips,
  getAdminTripDetails,
  listSavedLocations,
  createSavedLocation,
  listSavedLocationCatalog,
  getSavedLocationDetails,
  // User management
  listAllTransporters,
  getTransporterDetails,
  updateTransporterStatus,
  listAllDrivers,
  getDriverDetails,
  getDriverTimeline,
  updateDriverStatus,
  listAllPumpOwners,
  getPumpOwnerDetails,
  updatePumpOwnerStatus,
  listAllPumpStaff,
  getPumpStaffDetails,
  listAllCompanyUsers,
  getCompanyUserDetails,
  updateCompanyUserStatus,
  updatePumpStaffStatus,
  getDuplicateCustomers,
  mergeCustomers,
  getMilestoneRules,
  updateMilestoneRules,
  setWithdrawalPause,
  getFraudReviewQueue,
  getSettlementOversight,
  getAuditLogs,
  getSystemAuditLogs,
  listAllCustomers,
  updateCustomerStatus,
  adminUpdateTripStatus,
  adminReassignTrip,
} = require('../controllers/admin.controller');

// All routes require authentication
router.use(authenticate);

// Verify user is an admin
router.use((req, res, next) => {
  if (req.user.userType !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. This endpoint is for admins only.',
    });
  }
  next();
});

/**
 * @route   GET /api/admins/profile
 * @desc    Get admin profile
 * @access  Private (Admin only)
 */
router.get('/profile', getProfile);

/**
 * @route   PUT /api/admins/profile
 * @desc    Update admin profile
 * @access  Private (Admin only)
 */
router.put('/profile', updateProfile);

/**
 * @route   GET /api/admin/dashboard/stats
 * @desc    Get dashboard statistics
 * @access  Private (Admin only)
 */
router.get('/dashboard/stats', getDashboardStats);

/**
 * @route   GET /api/admin/analytics
 * @desc    Get system analytics
 * @access  Private (Admin only)
 */
router.get('/analytics', getSystemAnalytics);
router.get('/trips', listAdminTrips);
router.get('/trips/:id', getAdminTripDetails);
router.get('/locations', listSavedLocations);
router.post('/locations/saved', createSavedLocation);
router.get('/locations/saved', listSavedLocationCatalog);
router.get('/locations/saved/:id', getSavedLocationDetails);
router.get('/customers/list', listAllCustomers);
router.put('/customers/:id/status', updateCustomerStatus);
router.get('/customers/duplicates', getDuplicateCustomers);
router.post('/customers/merge', mergeCustomers);
router.put('/trips/:id/status', adminUpdateTripStatus);
router.put('/trips/:id/reassign', adminReassignTrip);
router.get('/settings/milestone-rules', getMilestoneRules);
router.put('/settings/milestone-rules', updateMilestoneRules);
router.put('/wallets/:userType/:userId/withdrawal', setWithdrawalPause);
router.get('/fraud/review-queue', getFraudReviewQueue);
router.get('/settlements/oversight', getSettlementOversight);
router.get('/audit-logs', getAuditLogs);
router.get('/system-audit-logs', getSystemAuditLogs);

// User Management Routes

/**
 * @route   GET /api/admin/transporters
 * @desc    List all transporters (Admin only)
 * @access  Private (Admin only)
 */
router.get('/transporters', listAllTransporters);

/**
 * @route   GET /api/admin/transporters/:id
 * @desc    Get transporter details (Admin only)
 * @access  Private (Admin only)
 */
router.get('/transporters/:id', getTransporterDetails);

/**
 * @route   PUT /api/admin/transporters/:id/status
 * @desc    Update transporter status (Admin only)
 * @access  Private (Admin only)
 */
router.put('/transporters/:id/status', updateTransporterStatus);

/**
 * @route   GET /api/admin/drivers
 * @desc    List all drivers (Admin only)
 * @access  Private (Admin only)
 */
router.get('/drivers', listAllDrivers);

/**
 * @route   GET /api/admin/drivers/:id
 * @desc    Get driver details (Admin only)
 * @access  Private (Admin only)
 */
router.get('/drivers/:id', getDriverDetails);

/**
 * @route   GET /api/admin/drivers/:id/timeline
 * @desc    Get driver timeline (Admin only)
 * @access  Private (Admin only)
 */
router.get('/drivers/:id/timeline', getDriverTimeline);

/**
 * @route   PUT /api/admin/drivers/:id/status
 * @desc    Update driver status (Admin only)
 * @access  Private (Admin only)
 */
router.put('/drivers/:id/status', updateDriverStatus);

/**
 * @route   GET /api/admin/pump-owners
 * @desc    List all pump owners (Admin only)
 * @access  Private (Admin only)
 */
router.get('/pump-owners', listAllPumpOwners);

/**
 * @route   GET /api/admin/pump-owners/:id
 * @desc    Get pump owner details (Admin only)
 * @access  Private (Admin only)
 */
router.get('/pump-owners/:id', getPumpOwnerDetails);

/**
 * @route   PUT /api/admin/pump-owners/:id/status
 * @desc    Update pump owner status (Admin only)
 * @access  Private (Admin only)
 */
router.put('/pump-owners/:id/status', updatePumpOwnerStatus);

/**
 * @route   GET /api/admin/pump-staff
 * @desc    List all pump staff (Admin only)
 * @access  Private (Admin only)
 */
router.get('/pump-staff', listAllPumpStaff);

/**
 * @route   GET /api/admin/pump-staff/:id
 * @desc    Get pump staff details (Admin only)
 * @access  Private (Admin only)
 */
router.get('/pump-staff/:id', getPumpStaffDetails);

/**
 * @route   PUT /api/admin/pump-staff/:id/status
 * @desc    Update pump staff status (Admin only)
 * @access  Private (Admin only)
 */
router.put('/pump-staff/:id/status', updatePumpStaffStatus);

/**
 * @route   GET /api/admin/company-users
 * @desc    List all company users (Admin only)
 * @access  Private (Admin only)
 */
router.get('/company-users', listAllCompanyUsers);

/**
 * @route   GET /api/admin/company-users/:id
 * @desc    Get company user details (Admin only)
 * @access  Private (Admin only)
 */
router.get('/company-users/:id', getCompanyUserDetails);

/**
 * @route   PUT /api/admin/company-users/:id/status
 * @desc    Update company user status (Admin only)
 * @access  Private (Admin only)
 */
router.put('/company-users/:id/status', updateCompanyUserStatus);

module.exports = router;
