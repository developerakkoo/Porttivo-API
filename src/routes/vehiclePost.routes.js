const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  createAvailability,
  searchAvailability,
  getMyPosts,
  getById,
  cancelPost,
  pausePost,
  resumePost,
  updateAvailability,
  addVehicleToPost,
} = require('../controllers/vehiclePost.controller');

// All endpoints require authentication
router.use(authenticate);

/**
 * POST /api/vehicle-posts
 * Create a vehicle availability post (transporter)
 */
router.post('/', createAvailability);
/**
 * PUT /api/vehicle-posts/:id/pause
 * Pause an active post (owner only) — hidden from marketplace search
 */
router.put('/:id/pause', pausePost);

/**
 * PUT /api/vehicle-posts/:id/resume
 * Resume a paused post (owner only)
 */
router.put('/:id/resume', resumePost);

/**
 * PUT /api/vehicle-posts/:id
 * Update an availability post (owner only)
 */
router.put('/:id', updateAvailability);

/**
 * GET /api/vehicle-posts
 * Search availability posts (visible to transporters searching loads)
 */
router.get('/', searchAvailability);

/**
 * GET /api/vehicle-posts/mine
 * Get posts created by the authenticated transporter
 */
router.get('/mine', getMyPosts);

/**
 * GET /api/vehicle-posts/:id
 * Single post (active public; cancelled etc. only for owner)
 */
router.get('/:id', getById);

/**
 * DELETE /api/vehicle-posts/:id
 * Cancel a post (owner only)
 */
router.delete('/:id', cancelPost);

/**
 * POST /api/vehicle-posts/:id/vehicles
 * Add a vehicle to a post (transporters)
 */
router.post('/:id/vehicles', addVehicleToPost);

module.exports = router;
