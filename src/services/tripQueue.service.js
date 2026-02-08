const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');

/**
 * Auto-queue service for managing trip queues and auto-activation
 */

/**
 * Activate next queued trip for a vehicle
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Object|null>} Activated trip or null if no queued trips
 */
const activateNextTrip = async (vehicleId) => {
  try {
    // Find next PLANNED trip for vehicle (oldest first)
    const nextTrip = await Trip.findOne({
      vehicleId,
      status: 'PLANNED',
    }).sort({ createdAt: 1 });

    if (!nextTrip) {
      return null; // No queued trips
    }

    // Check if vehicle has active trip (should not happen, but safety check)
    const activeTrip = await Trip.findOne({
      vehicleId,
      status: 'ACTIVE',
    });

    if (activeTrip) {
      console.warn(`Vehicle ${vehicleId} already has an active trip. Cannot activate next trip.`);
      return null;
    }

    // Activate trip
    nextTrip.status = 'ACTIVE';
    await nextTrip.save();

    // Populate references
    await nextTrip.populate('vehicleId', 'vehicleNumber trailerType');
    await nextTrip.populate('driverId', 'name mobile');
    await nextTrip.populate('transporterId', 'name company');

    return nextTrip;
  } catch (error) {
    console.error('Error activating next trip:', error);
    throw error;
  }
};

/**
 * Get queued trips for a vehicle
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Array>} Array of queued trips
 */
const getQueuedTrips = async (vehicleId) => {
  try {
    const queuedTrips = await Trip.find({
      vehicleId,
      status: 'PLANNED',
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company')
      .sort({ createdAt: 1 });

    return queuedTrips;
  } catch (error) {
    console.error('Error getting queued trips:', error);
    throw error;
  }
};

/**
 * Get active trip for a vehicle
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Object|null>} Active trip or null
 */
const getActiveTrip = async (vehicleId) => {
  try {
    const activeTrip = await Trip.findOne({
      vehicleId,
      status: 'ACTIVE',
    })
      .populate('vehicleId', 'vehicleNumber trailerType')
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company');

    return activeTrip;
  } catch (error) {
    console.error('Error getting active trip:', error);
    throw error;
  }
};

/**
 * Get vehicle queue status
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Object>} Queue status with active trip and queued trips count
 */
const getVehicleQueueStatus = async (vehicleId) => {
  try {
    const [activeTrip, queuedTrips] = await Promise.all([
      getActiveTrip(vehicleId),
      getQueuedTrips(vehicleId),
    ]);

    return {
      hasActiveTrip: !!activeTrip,
      activeTrip,
      queuedCount: queuedTrips.length,
      queuedTrips,
    };
  } catch (error) {
    console.error('Error getting vehicle queue status:', error);
    throw error;
  }
};

module.exports = {
  activateNextTrip,
  getQueuedTrips,
  getActiveTrip,
  getVehicleQueueStatus,
};
