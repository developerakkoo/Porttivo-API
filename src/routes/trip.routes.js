const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  createTrip,
  createTripBatch,
  getTrips,
  getTripById,
  updateTrip,
  cancelTrip,
  searchTrips,
  getTripsByStatus,
  getActiveTrips,
  getPendingPODTrips,
  shareTrip,
  getSharedTrip,
  renderSharedTrip,
  bookCustomerTrip,
  getCustomerTrips,
  getCustomerTripsByCustomer,
  getActiveCustomerTrips,
  getAvailableCustomerTrips,
  acceptCustomerTrip,
  rejectCustomerTrip,
  assignTripVehicle,
  assignTripDriver,
  assignCustomerTrip,
  saveTripDraft,
  listTripDrafts,
  getTripDraftById,
  deleteTripDraft,
} = require('../controllers/trip.controller');
const { acceptTripByDriver, startTrip, pauseTrip, resumeTrip, completeTrip, closeTripWithoutPOD } = require('../controllers/tripStatus.controller');
const {
  updateMilestone,
  getCurrentMilestone,
  getTripTimeline,
  getTripLocationTrail,
  getSharedTripLocationTrail,
} = require('../controllers/tripMilestone.controller');
const { uploadPOD, approvePOD } = require('../controllers/tripPOD.controller');
const { uploadPOD: uploadPODMiddleware, uploadMilestonePhotos, handleMulterError } = require('../middleware/upload.middleware');
const { optionalAuth } = require('../middleware/auth.middleware');

// Shared trip routes (public, no authentication required)
// These must be defined BEFORE the authenticate middleware
router.get('/shared/:token/view', renderSharedTrip); // HTML view route
router.get('/shared/:token', optionalAuth, getSharedTrip); // JSON API route
router.get('/shared/:token/location-trail', getSharedTripLocationTrail);

// All other trip routes require authentication
router.use(authenticate);

// Trip CRUD routes
router.post('/customer/book', bookCustomerTrip);
router.get('/customer/my-trips', getCustomerTrips);
router.get('/customer/history', getCustomerTripsByCustomer);
router.get('/customer/active', getActiveCustomerTrips);
router.get('/customer/available', getAvailableCustomerTrips);
router.put('/:id/accept', acceptCustomerTrip);
router.put('/:id/reject', rejectCustomerTrip);
router.put('/:id/assign-vehicle', assignTripVehicle);
router.put('/:id/assign-driver', assignTripDriver);
router.put('/:id/assign', assignCustomerTrip);
router.post('/drafts', saveTripDraft);
router.get('/drafts', listTripDrafts);
router.get('/drafts/:id', getTripDraftById);
router.delete('/drafts/:id', deleteTripDraft);
router.post('/', createTrip);
router.post('/batch', createTripBatch);
router.get('/', getTrips);
router.get('/search', searchTrips);
router.get('/active', getActiveTrips);
router.get('/pending-pod', getPendingPODTrips);
router.get('/status/:status', getTripsByStatus);
router.get('/:id', getTripById);
router.put('/:id', updateTrip);
router.put('/:id/cancel', cancelTrip);

// Trip status routes
router.put('/:id/accept-driver', acceptTripByDriver);
router.put('/:id/start', startTrip);
router.put('/:id/pause', pauseTrip);
router.put('/:id/resume', resumeTrip);
router.put('/:id/complete', completeTrip);
router.put('/:id/close-without-pod', closeTripWithoutPOD);

// Milestone routes
router.post('/:id/milestones/:milestoneNumber', uploadMilestonePhotos, handleMulterError, updateMilestone);
router.get('/:id/current-milestone', getCurrentMilestone);
router.get('/:id/timeline', getTripTimeline);
router.get('/:id/location-trail', getTripLocationTrail);

// POD routes
router.post('/:id/pod', uploadPODMiddleware, handleMulterError, uploadPOD);
router.put('/:id/pod/approve', approvePOD);

// Sharing routes
router.post('/:id/share', shareTrip);

module.exports = router;
