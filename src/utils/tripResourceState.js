const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');

const toIdString = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && value._id) {
    return String(value._id);
  }

  return String(value);
};

const collectTripResourceIds = (trip, options = {}) => {
  const { includeAssignments = true } = options;
  const vehicleIds = new Set();
  const driverIds = new Set();

  const addVehicle = (value) => {
    const id = toIdString(value);
    if (id) {
      vehicleIds.add(id);
    }
  };

  const addDriver = (value) => {
    const id = toIdString(value);
    if (id) {
      driverIds.add(id);
    }
  };

  if (trip) {
    addVehicle(trip.vehicleId);
    addDriver(trip.driverId);

    if (includeAssignments && Array.isArray(trip.assignments)) {
      trip.assignments.forEach((assignment) => {
        addVehicle(assignment?.vehicleId);
        addDriver(assignment?.driverId);
      });
    }
  }

  return { vehicleIds, driverIds };
};

const updateTripResourceBusyState = async (trip, isBusy, options = {}) => {
  const { vehicleIds, driverIds } = collectTripResourceIds(trip, options);
  const updates = [];

  if (vehicleIds.size > 0) {
    updates.push(
      Vehicle.updateMany(
        { _id: { $in: [...vehicleIds] } },
        { $set: { isBusy } }
      )
    );
  }

  if (driverIds.size > 0) {
    updates.push(
      Driver.updateMany(
        { _id: { $in: [...driverIds] } },
        { $set: { isBusy } }
      )
    );
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }
};

const markTripResourcesBusy = async (trip) => updateTripResourceBusyState(trip, true);

const releaseTripResources = async (trip) => updateTripResourceBusyState(trip, false);

const syncTripResourceBusyState = async (previousTrip, nextTrip, options = {}) => {
  const previous = collectTripResourceIds(previousTrip, options);
  const next = collectTripResourceIds(nextTrip, options);

  const releasedVehicleIds = [...previous.vehicleIds].filter((id) => !next.vehicleIds.has(id));
  const releasedDriverIds = [...previous.driverIds].filter((id) => !next.driverIds.has(id));
  const acquiredVehicleIds = [...next.vehicleIds].filter((id) => !previous.vehicleIds.has(id));
  const acquiredDriverIds = [...next.driverIds].filter((id) => !previous.driverIds.has(id));

  const updates = [];

  if (releasedVehicleIds.length > 0) {
    updates.push(
      Vehicle.updateMany(
        { _id: { $in: releasedVehicleIds } },
        { $set: { isBusy: false } }
      )
    );
  }

  if (releasedDriverIds.length > 0) {
    updates.push(
      Driver.updateMany(
        { _id: { $in: releasedDriverIds } },
        { $set: { isBusy: false } }
      )
    );
  }

  if (acquiredVehicleIds.length > 0) {
    updates.push(
      Vehicle.updateMany(
        { _id: { $in: acquiredVehicleIds } },
        { $set: { isBusy: true } }
      )
    );
  }

  if (acquiredDriverIds.length > 0) {
    updates.push(
      Driver.updateMany(
        { _id: { $in: acquiredDriverIds } },
        { $set: { isBusy: true } }
      )
    );
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }
};

module.exports = {
  collectTripResourceIds,
  markTripResourcesBusy,
  releaseTripResources,
  syncTripResourceBusyState,
};
