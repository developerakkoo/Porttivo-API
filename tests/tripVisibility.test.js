const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVisibleTrip } = require('../src/services/tripVisibility.service');

test('customer gets full execution visibility when customer is payer', () => {
  const trip = {
    _id: 'trip-1',
    customerId: 'customer-1',
    status: 'ACTIVE',
    tripType: 'IMPORT',
    customerOwnership: { payerType: 'CUSTOMER' },
    driverId: { _id: 'driver-1', name: 'Driver' },
    transporterId: { _id: 'transporter-1', name: 'Transporter' },
    vehicleId: { _id: 'vehicle-1', vehicleNumber: 'MH01AB1234', trailerType: '40FT' },
    shareConfig: { token: 'secret-token' },
  };

  const result = buildVisibleTrip(trip, {
    actor: { id: 'customer-1', userType: 'customer' },
    accessType: 'direct',
  });

  assert.equal(result.visibilityScope, 'FULL_EXECUTION');
  assert.equal(result.vehicle.vehicleNumber, 'MH01AB1234');
  assert.equal(result.shareConfig.token, undefined);
});

test('customer gets status-only visibility when transporter is payer', () => {
  const trip = {
    _id: 'trip-2',
    customerId: 'customer-1',
    status: 'ACTIVE',
    tripType: 'EXPORT',
    customerOwnership: { payerType: 'TRANSPORTER' },
    driverId: { _id: 'driver-1', name: 'Driver' },
    pickupLocation: { address: 'Pickup', city: 'Mumbai', state: 'MH' },
    dropLocation: { address: 'Drop', city: 'Pune', state: 'MH' },
    milestones: [{ milestoneNumber: 1, milestoneType: 'CONTAINER_PICKED', timestamp: new Date() }],
  };

  const result = buildVisibleTrip(trip, {
    actor: { id: 'customer-1', userType: 'customer' },
    accessType: 'direct',
  });

  assert.equal(result.visibilityScope, 'STATUS_ONLY');
  assert.equal(result.driverId, undefined);
  assert.equal(result.milestoneTimeline.length, 1);
});

test('origin pickup shared link only exposes pickup-specific payload', () => {
  const trip = {
    _id: 'trip-3',
    tripId: 'TRIP-3',
    status: 'ACTIVE',
    shareConfig: {
      linkType: 'ORIGIN_PICKUP',
      visibilityMode: 'STATUS_ONLY',
    },
    pickupLocation: { address: 'Pickup yard', city: 'Mumbai', state: 'MH' },
    hiredVehicle: { vehicleNumber: 'MH02CD4567', trailerType: '20FT' },
    milestones: [
      {
        milestoneNumber: 1,
        milestoneType: 'CONTAINER_PICKED',
        timestamp: new Date(),
        location: { latitude: 1, longitude: 2 },
      },
    ],
  };

  const result = buildVisibleTrip(trip, { accessType: 'shared' });

  assert.equal(result.visibilityScope, 'ORIGIN_PICKUP');
  assert.equal(result.originPickup.reached, true);
  assert.equal(result.vehicle.vehicleNumber, 'MH02CD4567');
  assert.equal(result.dropLocation, undefined);
});
