const { TRIP_STATUS } = require('../utils/tripState');

const STATUS_LABELS = {
  [TRIP_STATUS.BOOKED]: 'Booked',
  [TRIP_STATUS.ACCEPTED]: 'Accepted',
  [TRIP_STATUS.PLANNED]: 'Planned',
  [TRIP_STATUS.ACTIVE]: 'Active',
  [TRIP_STATUS.POD_PENDING]: 'POD Pending',
  [TRIP_STATUS.CLOSED_WITH_POD]: 'Closed With POD',
  [TRIP_STATUS.CLOSED_WITHOUT_POD]: 'Closed Without POD',
  [TRIP_STATUS.CANCELLED]: 'Cancelled',
};

const toPlainTrip = (trip) => (trip?.toObject ? trip.toObject() : trip);

const sanitizeVehicle = (trip) => {
  if (trip.vehicleId) {
    return {
      id: trip.vehicleId._id || trip.vehicleId.id || trip.vehicleId,
      vehicleNumber: trip.vehicleId.vehicleNumber,
      trailerType: trip.vehicleId.trailerType || null,
      source: 'OWNED_FLEET',
    };
  }

  if (trip.hiredVehicle) {
    return {
      id: null,
      vehicleNumber: trip.hiredVehicle.vehicleNumber,
      trailerType: trip.hiredVehicle.trailerType || null,
      source: 'HIRED_TRIP_ONLY',
    };
  }

  return null;
};

const buildCommonTripView = (trip) => ({
  id: trip._id,
  tripId: trip.tripId,
  status: trip.status,
  statusLabel: STATUS_LABELS[trip.status] || trip.status,
  bookingStatus: trip.bookingStatus || null,
  tripType: trip.tripType,
  containerNumber: trip.containerNumber || null,
  reference: trip.reference || null,
  scheduledAt: trip.scheduledAt || null,
  createdAt: trip.createdAt,
  startedAt: trip.startedAt || null,
  completedAt: trip.completedAt || null,
  podDueAt: trip.podDueAt || null,
  closedAt: trip.closedAt || null,
  currentMilestone:
    trip.currentMilestone || (typeof trip.getCurrentMilestone === 'function' ? trip.getCurrentMilestone() : null),
});

const buildStatusOnlyView = (trip) => ({
  ...buildCommonTripView(trip),
  visibilityScope: 'STATUS_ONLY',
  pickupLocation: trip.pickupLocation
    ? {
        address: trip.pickupLocation.address || '',
        city: trip.pickupLocation.city || '',
        state: trip.pickupLocation.state || '',
      }
    : null,
  dropLocation: trip.dropLocation
    ? {
        address: trip.dropLocation.address || '',
        city: trip.dropLocation.city || '',
        state: trip.dropLocation.state || '',
      }
    : null,
  milestoneTimeline: Array.isArray(trip.milestones)
    ? trip.milestones.map((milestone) => ({
        milestoneNumber: milestone.milestoneNumber,
        milestoneType: milestone.milestoneType,
        timestamp: milestone.timestamp,
      }))
    : [],
});

const buildOriginPickupView = (trip) => {
  const originMilestone = Array.isArray(trip.milestones)
    ? trip.milestones.find((milestone) => milestone.milestoneNumber === 1)
    : null;

  return {
    ...buildCommonTripView(trip),
    visibilityScope: 'ORIGIN_PICKUP',
    pickupLocation: trip.pickupLocation || null,
    vehicle: sanitizeVehicle(trip),
    originPickup: {
      reached: Boolean(originMilestone),
      timestamp: originMilestone?.timestamp || null,
      location: originMilestone?.location || null,
    },
  };
};

const buildFullExecutionView = (trip) => {
  const plainTrip = toPlainTrip(trip);
  const shareConfig = plainTrip.shareConfig
    ? {
        ...plainTrip.shareConfig,
        token: undefined,
      }
    : null;

  return {
    ...plainTrip,
    visibilityScope: 'FULL_EXECUTION',
    vehicle: sanitizeVehicle(plainTrip),
    shareConfig,
    shareToken: undefined,
    shareTokenExpiry: undefined,
    audit: undefined,
  };
};

const canCustomerSeeFullExecution = (trip, actor) => {
  if (actor?.userType !== 'customer') {
    return true;
  }

  const customerId = trip.customerId?._id?.toString?.() || trip.customerId?.toString?.();
  return customerId === actor.id && trip.customerOwnership?.payerType === 'CUSTOMER';
};

const resolveCustomerVisibility = (trip, actor) => {
  if (canCustomerSeeFullExecution(trip, actor)) {
    return 'FULL_EXECUTION';
  }

  return 'STATUS_ONLY';
};

const buildVisibleTrip = (trip, context = {}) => {
  const plainTrip = toPlainTrip(trip);
  const accessType = context.accessType || 'direct';

  if (accessType === 'shared') {
    const linkType = plainTrip.shareConfig?.linkType || 'TRIP_VISIBILITY';
    const sharedVisibilityMode = plainTrip.shareConfig?.visibilityMode || 'STATUS_ONLY';

    if (linkType === 'ORIGIN_PICKUP') {
      return buildOriginPickupView(plainTrip);
    }

    if (sharedVisibilityMode === 'FULL_EXECUTION') {
      return buildFullExecutionView(plainTrip);
    }

    return buildStatusOnlyView(plainTrip);
  }

  if (context.actor?.userType === 'customer') {
    const mode = resolveCustomerVisibility(plainTrip, context.actor);
    if (mode === 'FULL_EXECUTION') {
      return buildFullExecutionView(plainTrip);
    }

    return buildStatusOnlyView(plainTrip);
  }

  return buildFullExecutionView(plainTrip);
};

module.exports = {
  buildVisibleTrip,
};
