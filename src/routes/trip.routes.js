const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  createTrip,
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
} = require('../controllers/trip.controller');
const { startTrip, completeTrip } = require('../controllers/tripStatus.controller');
const {
  updateMilestone,
  getCurrentMilestone,
  getTripTimeline,
} = require('../controllers/tripMilestone.controller');
const { uploadPOD, approvePOD } = require('../controllers/tripPOD.controller');
const { uploadPOD: uploadPODMiddleware, uploadMilestonePhoto, handleMulterError } = require('../middleware/upload.middleware');
const { optionalAuth } = require('../middleware/auth.middleware');

// Shared trip routes (public, no authentication required)
// These must be defined BEFORE the authenticate middleware
router.get('/shared/:token/view', renderSharedTrip); // HTML view route
router.get('/shared/:token', optionalAuth, getSharedTrip); // JSON API route

// All other trip routes require authentication
router.use(authenticate);

// Trip CRUD routes
router.post('/', createTrip);
router.get('/', getTrips);
router.get('/search', searchTrips);
router.get('/active', getActiveTrips);
router.get('/pending-pod', getPendingPODTrips);
router.get('/status/:status', getTripsByStatus);
router.get('/:id', getTripById);
router.put('/:id', updateTrip);
router.put('/:id/cancel', cancelTrip);

// Trip status routes
router.put('/:id/start', startTrip);
router.put('/:id/complete', completeTrip);

// Milestone routes
router.post('/:id/milestones/:milestoneNumber', uploadMilestonePhoto, handleMulterError, updateMilestone);
router.get('/:id/current-milestone', getCurrentMilestone);
router.get('/:id/timeline', getTripTimeline);

// POD routes
router.post('/:id/pod', uploadPODMiddleware, handleMulterError, uploadPOD);
router.put('/:id/pod/approve', approvePOD);

// Sharing routes
router.post('/:id/share', shareTrip);

module.exports = router;
