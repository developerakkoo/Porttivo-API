const path = require('path');
const { loadWithMocks } = require('../tests/helpers/loadWithMocks');

(async () => {
  const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/trip.controller.js'), {
    '../models/Trip': {
      findById: async (id) => {
        if (id === 'trip-1') {
          return {
            _id: 'trip-1',
            transporterId: 'transporter-1',
            status: 'PLANNED',
            advanceAmount: null,
            toObject() {
              return { ...this };
            },
            async save() {
              return this;
            },
            async populate() {
              return this;
            }
          };
        }
        return null;
      }
    },
    '../models/Vehicle': {},
    '../models/Driver': {},
    '../models/Notification': { create: async () => ({}) },
    '../models/SystemConfig': { findOne: async () => ({ select: async () => null }) },
    '../utils/vehicleValidation': {
      checkVehicleHasAssignedTrip: async () => false,
      normalizeIndianVehicleRegistration: v => v,
      isValidIndianVehicleRegistration: () => true
    },
    '../utils/tripResourceState': {
      markTripResourcesBusy: async () => {},
      releaseTripResources: async () => {},
      syncTripResourceBusyState: async () => {}
    },
    '../utils/tripState': {
      TRIP_STATUS: {
        ACCEPTED: 'ACCEPTED',
        PLANNED: 'PLANNED',
        ACTIVE: 'ACTIVE',
        PAUSED: 'PAUSED',
        BOOKED: 'BOOKED',
        POD_PENDING: 'POD_PENDING',
        CLOSED_WITH_POD: 'CLOSED_WITH_POD',
        CLOSED_WITHOUT_POD: 'CLOSED_WITHOUT_POD',
        CANCELLED: 'CANCELLED'
      },
      BOOKING_STATUS: { OPEN: 'OPEN', ASSIGNED: 'ASSIGNED' },
      TRIP_STATUS_VALUES: [],
      TRIP_TYPE_VALUES: ['IMPORT', 'EXPORT', 'LOCAL']
    },
    '../services/socket.service': { emitTripUpdated: () => {} },
    '../middleware/permission.middleware': {
      getTransporterId: () => 'transporter-1',
      hasPermission: () => true
    },
    '../services/tripAccess.service': {
      canBookingBuyerViewTrip: async () => false,
      getMarketplaceTripMetaForUser: async () => null,
      getMarketplaceTripMetaForViewerId: async () => null,
      transporterPartyScopeCondition: () => ({})
    },
    '../services/wati.service': {
      sendTripCreatedConfirmation: async () => {},
      sendBookingAcceptedTemplate: async () => {},
      sendDriverVehicleAssignedTemplate: async () => {},
      sendBookingRejectedTemplate: async () => {},
      sendBookingRequestReceivedTemplate: async () => {}
    },
    '../services/savedLocation.service': { syncTripLocationsToSavedCatalog: async () => {} },
    '../services/tripVisibility.service': { buildVisibleTrip: trip => trip }
  });

  const req = {
    user: { id: 'transporter-1', userType: 'transporter' },
    params: { id: 'trip-1' },
    body: { advanceAmount: 500 }
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };

  await controller.updateTrip(req, res, (error) => {
    if (error) {
      console.error('ERROR', error);
      process.exit(1);
    }
  });

  console.log('RESULT', JSON.stringify({ statusCode: res.statusCode, body: res.body }, null, 2));
})();
