const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth.middleware');
const {
  createAvailability,
  searchAvailability,
  getMyPosts,
  cancelPost,
} = require('../controllers/vehiclePost.controller');

// All endpoints require authentication
router.use(authenticate);

/**
 * POST /api/vehicle-posts
 * Create a vehicle availability post (transporter)
 */
router.post('/', createAvailability);

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
 * DELETE /api/vehicle-posts/:id
 * Cancel a post (owner only)
 */
router.delete('/:id', cancelPost);

module.exports = router;
