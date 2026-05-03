const { getTransporterId, hasPermission } = require('../middleware/permission.middleware');

const MARKETPLACE_CAPABILITIES_SELLER = {
  assignVehicle: true,
  assignDriver: true,
  updateTrip: true,
  cancelTrip: true,
  approvePod: true,
  startTrip: true,
  completeTrip: true,
  shareTrip: true,
  closeWithoutPod: true,
};

const MARKETPLACE_CAPABILITIES_BUYER = {
  assignVehicle: false,
  assignDriver: false,
  updateTrip: false,
  cancelTrip: false,
  approvePod: false,
  startTrip: false,
  completeTrip: false,
  shareTrip: false,
  closeWithoutPod: false,
};

const isMarketplaceBookingTrip = (trip) => Boolean(trip?.isFromBooking && trip?.bookingId);

const isTripSeller = (trip, user) => {
  if (!isMarketplaceBookingTrip(trip)) return false;
  const viewer = getTransporterId(user);
  if (!viewer) return false;
  const sellerId = trip.transporterId?._id?.toString?.() || trip.transporterId?.toString?.();
  return sellerId === viewer;
};

const isTripBuyer = (trip, user) => {
  if (!isMarketplaceBookingTrip(trip)) return false;
  const viewer = getTransporterId(user);
  if (!viewer) return false;
  const buyerId = trip.customerId?._id?.toString?.() || trip.customerId?.toString?.();
  return buyerId === viewer;
};

/** Booking counterparty (buyer transporter); uses org id for company-users. */
const canBookingBuyerViewTrip = (trip, user) => isTripBuyer(trip, user);

const getMarketplaceTripMetaForUser = (trip, user) => {
  if (!isMarketplaceBookingTrip(trip)) return null;
  if (isTripSeller(trip, user)) {
    return { marketplaceRole: 'seller', capabilities: { ...MARKETPLACE_CAPABILITIES_SELLER } };
  }
  if (isTripBuyer(trip, user)) {
    return { marketplaceRole: 'buyer', capabilities: { ...MARKETPLACE_CAPABILITIES_BUYER } };
  }
  return null;
};

/** For list serialization where we only have viewer transporter id (no full user). */
const getMarketplaceTripMetaForViewerId = (trip, viewerTransporterId) => {
  if (!isMarketplaceBookingTrip(trip) || !viewerTransporterId) return null;
  const v = String(viewerTransporterId);
  const sellerId = trip.transporterId?._id?.toString?.() || trip.transporterId?.toString?.();
  const buyerId = trip.customerId?._id?.toString?.() || trip.customerId?.toString?.();
  if (sellerId === v) {
    return { marketplaceRole: 'seller', capabilities: { ...MARKETPLACE_CAPABILITIES_SELLER } };
  }
  if (buyerId === v) {
    return { marketplaceRole: 'buyer', capabilities: { ...MARKETPLACE_CAPABILITIES_BUYER } };
  }
  return null;
};

const transporterPartyScopeCondition = (viewerTransporterId) => ({
  $or: [
    { transporterId: viewerTransporterId },
    { isFromBooking: true, customerId: viewerTransporterId },
  ],
});

/**
 * True if this transporter org may view trip execution details (milestones, timeline)
 * for trips they sell or marketplace trips they bought.
 */
const canTransporterPartyViewTripExecution = (user, trip) => {
  if (!user || !trip) return false;
  if (user.userType === 'admin') return true;

  if (user.userType === 'company-user' && !hasPermission(user, 'viewTrips')) {
    return false;
  }

  const tid = getTransporterId(user);
  if (!tid) return false;

  if (trip.transporterId && trip.transporterId.toString() === tid) {
    return true;
  }

  return isTripBuyer(trip, user);
};

module.exports = {
  MARKETPLACE_CAPABILITIES_SELLER,
  MARKETPLACE_CAPABILITIES_BUYER,
  isMarketplaceBookingTrip,
  isTripSeller,
  isTripBuyer,
  canBookingBuyerViewTrip,
  getMarketplaceTripMetaForUser,
  getMarketplaceTripMetaForViewerId,
  transporterPartyScopeCondition,
  canTransporterPartyViewTripExecution,
};
