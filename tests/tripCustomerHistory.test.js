const assert = require('node:assert/strict');
const path = require('node:path');
const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

class MockQuery {
  constructor(result) {
    this.result = result;
  }

  populate() {
    return this;
  }

  sort() {
    return this;
  }

  skip() {
    return this;
  }

  limit() {
    return this;
  }

  then(resolve) {
    return Promise.resolve(this.result).then(resolve);
  }
}

module.exports = [
  {
    name: 'transporter can lookup customer trips by customer ID and name',
    async run() {
      let capturedQuery = null;

      const Trip = {
        find: (query) => {
          capturedQuery = query;
          return new MockQuery([
            {
              _id: 'trip-1',
              tripId: 'TRIP-001',
              customerId: 'customer-1',
              customerName: 'ACME LTD',
              status: 'BOOKED',
            },
          ]);
        },
        countDocuments: async () => 1,
      };

      const controller = loadWithMocks(path.resolve(process.cwd(), 'src/controllers/trip.controller.js'), {
        '../models/Trip': Trip,
        '../models/Vehicle': {},
        '../models/Driver': {},
        '../models/Customer': {},
        '../models/Transporter': {},
        '../models/Notification': { create: async () => ({}) },
        '../models/SystemConfig': {
          findOne: () => ({
            select: async () => null,
          }),
        },
        '../utils/vehicleValidation': {
          checkVehicleHasAssignedTrip: async () => false,
          checkVehicleHasActiveTrip: async () => false,
          checkDriverHasAssignedTrip: async () => false,
          buildResourceTripQuery: () => ({}),
          getDriverAvailabilityState: () => ({}),
          normalizeIndianVehicleRegistration: (value) => value,
          isValidIndianVehicleRegistration: () => true,
        },
        '../utils/tripResourceState': {
          markTripResourcesBusy: async () => {},
          releaseTripResources: async () => {},
          syncTripResourceBusyState: async () => {},
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
            CANCELLED: 'CANCELLED',
          },
          BOOKING_STATUS: { OPEN: 'OPEN', ASSIGNED: 'ASSIGNED' },
          TRIP_STATUS_VALUES: [],
          TRIP_TYPE_VALUES: ['IMPORT', 'EXPORT', 'LOCAL'],
        },
        '../services/socket.service': {
          emitTripCreated: () => {},
          emitTripCreatedForCustomer: () => {},
          emitBookingAccepted: () => {},
          emitBookingRejected: () => {},
          emitTripVehicleAssigned: () => {},
          emitTripDriverAssigned: () => {},
          emitTripAssigned: () => {},
          emitTripCancelled: () => {},
          emitTripUpdated: () => {},
        },
        '../middleware/permission.middleware': {
          getTransporterId: () => 'transporter-1',
          hasPermission: () => true,
        },
        '../services/tripAccess.service': {
          canBookingBuyerViewTrip: async () => false,
          getMarketplaceTripMetaForUser: async () => null,
          getMarketplaceTripMetaForViewerId: async () => null,
          transporterPartyScopeCondition: () => ({ transporterId: 'transporter-1' }),
        },
        '../services/wati.service': {
          sendTripCreatedConfirmation: async () => {},
          sendBookingAcceptedTemplate: async () => {},
          sendDriverVehicleAssignedTemplate: async () => {},
          sendBookingRejectedTemplate: async () => {},
          sendBookingRequestReceivedTemplate: async () => {},
        },
        '../services/savedLocation.service': {
          syncTripLocationsToSavedCatalog: async () => {},
        },
        '../services/tripVisibility.service': {
          buildVisibleTrip: (trip) => trip,
        },
      });

      const req = {
        user: { id: 'transporter-1', userType: 'transporter' },
        query: {
          customerId: 'customer-1',
          customerName: 'Acme Ltd',
        },
      };
      const res = createMockRes();

      await controller.getCustomerTripsByCustomer(req, res, (error) => {
        throw error;
      });

      assert.equal(res.statusCode, 200);
      assert.equal(capturedQuery.customerId, 'customer-1');
      assert.equal(capturedQuery.customerName.$options, 'i');
      assert.match(capturedQuery.customerName.$regex, /Acme/);
      assert.equal(res.body.data.length, 1);
    },
  },
];
