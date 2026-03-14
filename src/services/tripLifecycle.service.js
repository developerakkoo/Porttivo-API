const { TRIP_STATUS } = require('../utils/tripState');

const PHOTO_RULE_BY_MILESTONE = Object.freeze({
  CONTAINER_PICKED: 'containerPickedRequired',
  REACHED_LOCATION: 'reachedLocationRequired',
  LOADING_UNLOADING: 'loadingUnloadingRequired',
  REACHED_DESTINATION: 'reachedDestinationRequired',
  TRIP_COMPLETED: 'tripCompletedRequired',
});

const toAuditUserType = (userType) => {
  switch (userType) {
    case 'company-user':
      return 'COMPANY_USER';
    case 'transporter':
      return 'TRANSPORTER';
    case 'customer':
      return 'CUSTOMER';
    case 'driver':
      return 'DRIVER';
    case 'admin':
      return 'ADMIN';
    default:
      return 'SYSTEM';
  }
};

const isMilestonePhotoRequired = (trip, milestoneType) => {
  const ruleKey = PHOTO_RULE_BY_MILESTONE[milestoneType];
  return Boolean(ruleKey && trip?.photoRules?.[ruleKey]);
};

const ensureMilestonePhoto = (trip, milestoneType, photo) => {
  if (isMilestonePhotoRequired(trip, milestoneType) && !photo) {
    return `Photo is required for milestone ${milestoneType}`;
  }

  return null;
};

const isPodDeadlineExpired = (trip) =>
  trip?.status === TRIP_STATUS.POD_PENDING &&
  trip?.podDueAt &&
  new Date(trip.podDueAt).getTime() <= Date.now() &&
  !trip?.POD?.photo;

const autoCloseTripIfExpired = async (trip, actor = { userId: null, userType: 'SYSTEM' }) => {
  if (!isPodDeadlineExpired(trip)) {
    return { trip, autoClosed: false };
  }

  trip.status = TRIP_STATUS.CLOSED_WITHOUT_POD;
  trip.closedAt = new Date();
  trip.closedReason = 'POD_TIMEOUT';
  trip.audit = trip.audit || {};
  trip.audit.updatedBy = {
    userId: actor.userId || null,
    userType: toAuditUserType(actor.userType),
  };
  await trip.save();

  return { trip, autoClosed: true };
};

module.exports = {
  toAuditUserType,
  ensureMilestonePhoto,
  isPodDeadlineExpired,
  autoCloseTripIfExpired,
};
