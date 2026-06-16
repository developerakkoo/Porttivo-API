const SavedLocation = require('../models/SavedLocation');

const buildSavedLocationKey = (location) => {
  if (!location) {
    return null;
  }

  if (location.placeId) {
    return { placeId: location.placeId.trim() };
  }

  if (Array.isArray(location.coordinates) && location.coordinates.length === 2 && location.formattedAddress) {
    return {
      formattedAddress: location.formattedAddress.trim(),
      coordinates: location.coordinates.map((value) => Number(value)),
    };
  }

  return null;
};

const buildSavedLocationLabel = (location, fallbackPrefix) => {
  return location?.name?.trim() || location?.formattedAddress?.trim() || fallbackPrefix;
};

const upsertSavedLocationFromTripLocation = async ({ location, label, actor }) => {
  if (!location || !location.formattedAddress || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
    return null;
  }

  const key = buildSavedLocationKey(location);
  if (!key) {
    return null;
  }

  const query = key.placeId
    ? { 'location.placeId': key.placeId }
    : {
        'location.formattedAddress': key.formattedAddress,
        'location.coordinates.0': key.coordinates[0],
        'location.coordinates.1': key.coordinates[1],
      };

  const existing = await SavedLocation.findOne(query);
  if (existing) {
    existing.location = location;
    existing.label = existing.label || label;
    existing.updatedBy = {
      userId: actor?.userId || null,
      userType: actor?.userType || 'SYSTEM',
    };
    await existing.save();
    return existing;
  }

  return SavedLocation.create({
    label,
    location,
    isActive: true,
    createdBy: {
      userId: actor?.userId || null,
      userType: actor?.userType || 'SYSTEM',
    },
    updatedBy: {
      userId: actor?.userId || null,
      userType: actor?.userType || 'SYSTEM',
    },
  });
};

const syncTripLocationsToSavedCatalog = async ({ trip, actor }) => {
  if (!trip) {
    return;
  }

  const operations = [];

  if (trip.pickupLocation) {
    operations.push(
      upsertSavedLocationFromTripLocation({
        location: trip.pickupLocation,
        label: buildSavedLocationLabel(trip.pickupLocation, `Pickup ${trip.tripId || 'Location'}`),
        actor,
      })
    );
  }

  if (trip.intermediateLocation) {
    operations.push(
      upsertSavedLocationFromTripLocation({
        location: trip.intermediateLocation,
        label: buildSavedLocationLabel(trip.intermediateLocation, `Point B ${trip.tripId || 'Location'}`),
        actor,
      })
    );
  }

  if (trip.dropLocation) {
    operations.push(
      upsertSavedLocationFromTripLocation({
        location: trip.dropLocation,
        label: buildSavedLocationLabel(trip.dropLocation, `Drop ${trip.tripId || 'Location'}`),
        actor,
      })
    );
  }

  await Promise.all(operations);
};

module.exports = {
  syncTripLocationsToSavedCatalog,
};
