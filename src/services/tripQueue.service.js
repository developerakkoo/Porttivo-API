const Trip = require('../models/Trip');
const Vehicle = require('../models/Vehicle');
const { TRIP_STATUS } = require('../utils/tripState');

const buildQueueQuery = (vehicleSelector) => {
  if (vehicleSelector?.vehicleId) {
    return { vehicleId: vehicleSelector.vehicleId };
  }

  if (vehicleSelector?.hiredVehicle?.vehicleNumber) {
    return { 'hiredVehicle.vehicleNumber': vehicleSelector.hiredVehicle.vehicleNumber };
  }

  return vehicleSelector && typeof vehicleSelector === 'object' && !Array.isArray(vehicleSelector)
    ? vehicleSelector
    : { vehicleId: vehicleSelector };
};

/**
 * Auto-queue service for managing trip queues and auto-activation
 */

/**
 * Activate next queued trip for a vehicle
 * @param {String|Object} vehicleSelector - Vehicle selector
 * @returns {Promise<Object|null>} Activated trip or null if no queued trips
 */
const activateNextTrip = async (vehicleSelector) => {
  try {
    const baseQuery = buildQueueQuery(vehicleSelector);

    // Find next PLANNED trip for vehicle (oldest first)
    const nextTrip = await Trip.findOne({
      ...baseQuery,
      status: TRIP_STATUS.PLANNED,
    }).sort({ createdAt: 1 });

    if (!nextTrip) {
      return null; // No queued trips
    }

    if (!nextTrip.driverId) {
      console.warn(`Next trip ${nextTrip._id} has no driver assigned. Auto-activation skipped.`);
      return null;
    }

    // Check if vehicle has active trip (should not happen, but safety check)
    const activeTrip = await Trip.findOne({
      ...baseQuery,
      status: TRIP_STATUS.ACTIVE,
    });

    if (activeTrip) {
      console.warn(`Vehicle selector ${JSON.stringify(baseQuery)} already has an active trip. Cannot activate next trip.`);
      return null;
    }

    // Activate trip
    nextTrip.status = TRIP_STATUS.ACTIVE;
    await nextTrip.save();

    // Populate references
    if (nextTrip.vehicleId) {
      await nextTrip.populate('vehicleId', 'vehicleNumber trailerType');
    }
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
 * @param {String|Object} vehicleSelector - Vehicle selector
 * @returns {Promise<Array>} Array of queued trips
 */
const getQueuedTrips = async (vehicleSelector) => {
  try {
    const baseQuery = buildQueueQuery(vehicleSelector);
    const queuedTrips = await Trip.find({
      ...baseQuery,
      status: TRIP_STATUS.PLANNED,
    })
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company')
      .sort({ createdAt: 1 });

    await Trip.populate(queuedTrips.filter((trip) => trip.vehicleId), {
      path: 'vehicleId',
      select: 'vehicleNumber trailerType',
    });

    return queuedTrips;
  } catch (error) {
    console.error('Error getting queued trips:', error);
    throw error;
  }
};

/**
 * Get active trip for a vehicle
 * @param {String|Object} vehicleSelector - Vehicle selector
 * @returns {Promise<Object|null>} Active trip or null
 */
const getActiveTrip = async (vehicleSelector) => {
  try {
    const baseQuery = buildQueueQuery(vehicleSelector);
    const activeTrip = await Trip.findOne({
      ...baseQuery,
      status: TRIP_STATUS.ACTIVE,
    })
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company');

    if (activeTrip?.vehicleId) {
      await activeTrip.populate('vehicleId', 'vehicleNumber trailerType');
    }

    return activeTrip;
  } catch (error) {
    console.error('Error getting active trip:', error);
    throw error;
  }
};

/**
 * Get vehicle queue status
 * @param {String|Object} vehicleSelector - Vehicle selector
 * @returns {Promise<Object>} Queue status with active trip and queued trips count
 */
const getVehicleQueueStatus = async (vehicleSelector) => {
  try {
    const [activeTrip, queuedTrips] = await Promise.all([
      getActiveTrip(vehicleSelector),
      getQueuedTrips(vehicleSelector),
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
