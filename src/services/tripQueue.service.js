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

const buildVehicleSelectorFromTrip = (trip) => {
  if (trip?.vehicleId) {
    const vehicleId = trip.vehicleId._id || trip.vehicleId;
    return { vehicleId };
  }

  if (trip?.hiredVehicle?.vehicleNumber) {
    return { 'hiredVehicle.vehicleNumber': trip.hiredVehicle.vehicleNumber };
  }

  return null;
};

const getNextQueueSequence = async (vehicleSelector, excludeTripId = null) => {
  const baseQuery = buildQueueQuery(vehicleSelector);
  const query = {
    ...baseQuery,
    status: TRIP_STATUS.PLANNED,
  };
  if (excludeTripId) {
    query._id = { $ne: excludeTripId };
  }

  const count = await Trip.countDocuments(query);
  return count + 1;
};

const assignTripQueueMetadata = async (trip) => {
  if (!trip || trip.status !== TRIP_STATUS.PLANNED) {
    return trip;
  }

  const vehicleSelector = buildVehicleSelectorFromTrip(trip);
  if (!vehicleSelector) {
    return trip;
  }

  const queueSequence = await getNextQueueSequence(vehicleSelector, trip._id);
  trip.queueSequence = queueSequence;
  if (queueSequence > 1 || !trip.queuedAt) {
    trip.queuedAt = trip.queuedAt || new Date();
  }
  await trip.save();
  return trip;
};

const getTripQueueInfo = async (trip) => {
  if (!trip || trip.status === TRIP_STATUS.DRAFT || trip.status !== TRIP_STATUS.PLANNED) {
    return { queuePosition: null, isQueued: false, blockingTripId: null };
  }

  const vehicleSelector = buildVehicleSelectorFromTrip(trip);
  if (!vehicleSelector) {
    return { queuePosition: null, isQueued: false, blockingTripId: null };
  }

  const baseQuery = buildQueueQuery(vehicleSelector);
  const [activeTrip, queuedTrips] = await Promise.all([
    getActiveTrip(vehicleSelector),
    Trip.find({ ...baseQuery, status: TRIP_STATUS.PLANNED })
      .sort({ queueSequence: 1, createdAt: 1 })
      .select('_id tripId queueSequence'),
  ]);

  const tripId = trip._id?.toString?.() || String(trip._id);
  const index = queuedTrips.findIndex((queuedTrip) => queuedTrip._id.toString() === tripId);
  const queuePosition = index >= 0 ? index + 1 : trip.queueSequence || null;
  const blockingTrip = activeTrip || (queuePosition > 1 ? queuedTrips[0] : null);
  const isQueued = !!activeTrip || queuePosition > 1;

  return {
    queuePosition,
    isQueued,
    blockingTripId: blockingTrip?._id?.toString?.() || blockingTrip?._id || null,
  };
};

const assertTripCanStartFromQueue = async (trip) => {
  const queueInfo = await getTripQueueInfo(trip);
  if (queueInfo.isQueued && queueInfo.queuePosition !== 1) {
    return 'This trip is queued. Complete the active trip first.';
  }

  const vehicleSelector = buildVehicleSelectorFromTrip(trip);
  if (!vehicleSelector) {
    return null;
  }

  const activeTrip = await getActiveTrip(vehicleSelector);
  if (activeTrip && activeTrip._id.toString() !== trip._id.toString()) {
    return 'Vehicle already has an active trip. Please complete or cancel the active trip first.';
  }

  return null;
};

module.exports = {
  activateNextTrip,
  getQueuedTrips,
  getActiveTrip,
  getVehicleQueueStatus,
  buildVehicleSelectorFromTrip,
  getNextQueueSequence,
  assignTripQueueMetadata,
  getTripQueueInfo,
  assertTripCanStartFromQueue,
};
