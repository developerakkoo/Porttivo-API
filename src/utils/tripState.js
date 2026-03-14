const TRIP_STATUS = Object.freeze({
  BOOKED: 'BOOKED',
  ACCEPTED: 'ACCEPTED',
  PLANNED: 'PLANNED',
  ACTIVE: 'ACTIVE',
  POD_PENDING: 'POD_PENDING',
  CLOSED_WITH_POD: 'CLOSED_WITH_POD',
  CLOSED_WITHOUT_POD: 'CLOSED_WITHOUT_POD',
  CANCELLED: 'CANCELLED',
});

const BOOKING_STATUS = Object.freeze({
  OPEN: 'OPEN',
  ACCEPTED: 'ACCEPTED',
  ASSIGNED: 'ASSIGNED',
});

const TRIP_STATUS_VALUES = Object.freeze(Object.values(TRIP_STATUS));
const BOOKING_STATUS_VALUES = Object.freeze(Object.values(BOOKING_STATUS));
const CLOSED_TRIP_STATUSES = Object.freeze([
  TRIP_STATUS.CLOSED_WITH_POD,
  TRIP_STATUS.CLOSED_WITHOUT_POD,
]);
const DRIVER_HISTORY_STATUSES = Object.freeze([
  TRIP_STATUS.POD_PENDING,
  TRIP_STATUS.CLOSED_WITH_POD,
  TRIP_STATUS.CLOSED_WITHOUT_POD,
  TRIP_STATUS.CANCELLED,
]);

const POD_PENDING_HOURS = 72;

const calculatePodDueAt = (completedAt = new Date()) => {
  const podDueAt = new Date(completedAt);
  podDueAt.setHours(podDueAt.getHours() + POD_PENDING_HOURS);
  return podDueAt;
};

const isClosedTripStatus = (status) => CLOSED_TRIP_STATUSES.includes(status);

module.exports = {
  TRIP_STATUS,
  BOOKING_STATUS,
  TRIP_STATUS_VALUES,
  BOOKING_STATUS_VALUES,
  CLOSED_TRIP_STATUSES,
  DRIVER_HISTORY_STATUSES,
  POD_PENDING_HOURS,
  calculatePodDueAt,
  isClosedTripStatus,
};
