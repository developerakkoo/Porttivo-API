const Trip = require('../models/Trip');
const { TRIP_STATUS } = require('../utils/tripState');

const COMMITTED_STATUSES = [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED];

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

const tripIdString = (trip) => trip?._id?.toString?.() || String(trip?._id || '');

/**
 * Auto-queue service for managing trip queues and auto-activation
 */

const activateNextTrip = async (vehicleSelector) => {
  try {
    const baseQuery = buildQueueQuery(vehicleSelector);

    const nextTrip = await Trip.findOne({
      ...baseQuery,
      status: TRIP_STATUS.PLANNED,
    }).sort({ createdAt: 1 });

    if (!nextTrip) {
      return null;
    }

    if (!nextTrip.driverId) {
      console.warn(`Next trip ${nextTrip._id} has no driver assigned. Auto-activation skipped.`);
      return null;
    }

    const committedTrip = await Trip.findOne({
      ...baseQuery,
      status: { $in: COMMITTED_STATUSES },
    });

    if (committedTrip) {
      console.warn(`Vehicle selector ${JSON.stringify(baseQuery)} already has a committed trip. Cannot activate next trip.`);
      return null;
    }

    const driverId = nextTrip.driverId?._id || nextTrip.driverId;
    if (driverId) {
      const driverCommitted = await getCommittedTripForDriver(driverId, nextTrip._id);
      if (driverCommitted) {
        console.warn(`Driver ${driverId} already has a committed trip. Cannot activate next trip.`);
        return null;
      }
    }

    nextTrip.status = TRIP_STATUS.ACTIVE;
    await nextTrip.save();

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

const getActiveTrip = async (vehicleSelector) => {
  return getCommittedTripForVehicle(vehicleSelector);
};

const getCommittedTripForVehicle = async (vehicleSelector, excludeTripId = null) => {
  try {
    const baseQuery = buildQueueQuery(vehicleSelector);
    const query = {
      ...baseQuery,
      status: { $in: COMMITTED_STATUSES },
    };
    if (excludeTripId) {
      query._id = { $ne: excludeTripId };
    }

    const committedTrip = await Trip.findOne(query)
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company');

    if (committedTrip?.vehicleId) {
      await committedTrip.populate('vehicleId', 'vehicleNumber trailerType');
    }

    return committedTrip;
  } catch (error) {
    console.error('Error getting committed trip for vehicle:', error);
    throw error;
  }
};

const buildDriverSelectorFromTrip = (trip) => {
  const driverId = trip?.driverId?._id || trip?.driverId;
  if (!driverId) {
    return null;
  }
  return { driverId };
};

const getCommittedTripForDriver = async (driverId, excludeTripId = null) => {
  try {
    const normalizedDriverId = driverId?._id || driverId;
    if (!normalizedDriverId) {
      return null;
    }

    const query = {
      driverId: normalizedDriverId,
      status: { $in: COMMITTED_STATUSES },
    };
    if (excludeTripId) {
      query._id = { $ne: excludeTripId };
    }

    const committedTrip = await Trip.findOne(query)
      .populate('driverId', 'name mobile')
      .populate('transporterId', 'name company');

    if (committedTrip?.vehicleId) {
      await committedTrip.populate('vehicleId', 'vehicleNumber trailerType');
    }

    return committedTrip;
  } catch (error) {
    console.error('Error getting committed trip for driver:', error);
    throw error;
  }
};

const getVehicleQueueStatus = async (vehicleSelector) => {
  try {
    const [activeTrip, queuedTrips] = await Promise.all([
      getCommittedTripForVehicle(vehicleSelector),
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

  const currentTripId = tripIdString(trip);
  const vehicleSelector = buildVehicleSelectorFromTrip(trip);
  const driverId = trip.driverId?._id || trip.driverId;

  const [vehicleCommittedTrip, driverCommittedTrip] = await Promise.all([
    vehicleSelector ? getCommittedTripForVehicle(vehicleSelector, trip._id) : Promise.resolve(null),
    driverId ? getCommittedTripForDriver(driverId, trip._id) : Promise.resolve(null),
  ]);

  const vehicleBlocker = vehicleCommittedTrip;
  const driverBlocker =
    driverCommittedTrip && tripIdString(driverCommittedTrip) !== currentTripId
      ? driverCommittedTrip
      : null;
  const blockingTrip = vehicleBlocker || driverBlocker;

  let queuePosition = null;
  let isQueued = !!blockingTrip;

  if (vehicleSelector) {
    const baseQuery = buildQueueQuery(vehicleSelector);
    const queuedTrips = await Trip.find({ ...baseQuery, status: TRIP_STATUS.PLANNED })
      .sort({ queueSequence: 1, createdAt: 1 })
      .select('_id tripId queueSequence');

    const index = queuedTrips.findIndex((queuedTrip) => queuedTrip._id.toString() === currentTripId);
    queuePosition = index >= 0 ? index + 1 : trip.queueSequence || null;
    isQueued = isQueued || (queuePosition ?? 0) > 1;
  } else if (driverBlocker) {
    queuePosition = 1;
    isQueued = true;
  }

  if (isQueued && !blockingTrip && queuePosition && queuePosition > 1 && vehicleSelector) {
    const baseQuery = buildQueueQuery(vehicleSelector);
    const queuedTrips = await Trip.find({ ...baseQuery, status: TRIP_STATUS.PLANNED })
      .sort({ queueSequence: 1, createdAt: 1 })
      .select('_id tripId queueSequence');
    const firstQueued = queuedTrips[0];
    return {
      queuePosition,
      isQueued: true,
      blockingTripId: firstQueued?._id?.toString?.() || firstQueued?._id || null,
    };
  }

  return {
    queuePosition,
    isQueued,
    blockingTripId: blockingTrip ? tripIdString(blockingTrip) : null,
  };
};

const assertTripCanStartFromQueue = async (trip) => {
  const queueInfo = await getTripQueueInfo(trip);
  if (queueInfo.isQueued && queueInfo.queuePosition !== 1) {
    return 'This trip is queued. Complete the active trip first.';
  }

  const currentTripId = tripIdString(trip);
  const vehicleSelector = buildVehicleSelectorFromTrip(trip);
  const driverId = trip.driverId?._id || trip.driverId;

  if (vehicleSelector) {
    const vehicleCommitted = await getCommittedTripForVehicle(vehicleSelector, trip._id);
    if (vehicleCommitted && tripIdString(vehicleCommitted) !== currentTripId) {
      return 'Vehicle already has an active trip. Please complete or cancel the active trip first.';
    }
  }

  if (driverId) {
    const driverCommitted = await getCommittedTripForDriver(driverId, trip._id);
    if (driverCommitted && tripIdString(driverCommitted) !== currentTripId) {
      return 'Driver already has an active trip. Please complete or cancel the active trip first.';
    }
  }

  if (queueInfo.isQueued && queueInfo.blockingTripId && queueInfo.blockingTripId !== currentTripId) {
    return 'This trip is queued. Complete the active trip first.';
  }

  return null;
};

module.exports = {
  activateNextTrip,
  getQueuedTrips,
  getActiveTrip,
  getCommittedTripForVehicle,
  getCommittedTripForDriver,
  getVehicleQueueStatus,
  buildVehicleSelectorFromTrip,
  buildDriverSelectorFromTrip,
  getNextQueueSequence,
  assignTripQueueMetadata,
  getTripQueueInfo,
  assertTripCanStartFromQueue,
};
