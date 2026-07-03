const test = require('node:test');
const assert = require('node:assert/strict');

const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

test('SurePass service normalizes a successful RC lookup', async () => {
  const originalFetch = global.fetch;

  try {
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        status_code: 200,
        message: null,
        message_code: 'success',
        data: {
          rc_number: 'MH16DY6519',
          owner_name: 'Test Owner',
        },
      }),
    });

    const { verifyRcFull } = loadWithMocks('../src/services/surepass.service.js', {
      '../config/env': {
        surepassApiToken: 'token-123',
        surepassRcFullUrl: 'https://example.test',
        surepassRequestTimeoutMs: 1000,
      },
    });

    const result = await verifyRcFull('MH 16 DY 6519');

    assert.equal(result.ok, true);
    assert.equal(result.verified, true);
    assert.equal(result.status, 'verified');
    assert.equal(result.data.rc_number, 'MH16DY6519');
  } finally {
    global.fetch = originalFetch;
  }
});

test('createVehicle stores RC verification and returns a summary', async () => {
  const captured = {
    created: null,
    verificationInput: null,
  };

  const controller = loadWithMocks('../src/controllers/vehicle.controller.js', {
    '../models/Vehicle': {
      findOne: async () => null,
      create: async (payload) => {
        captured.created = payload;
        return {
          _id: 'vehicle-1',
          ...payload,
          async populate() {
            return this;
          },
        };
      },
    },
    '../models/Trip': {},
    '../models/Driver': {
      findOne: async () => null,
    },
    '../services/surepass.service': {
      verifyRcFull: async (vehicleNumber) => {
        captured.verificationInput = vehicleNumber;
        return {
          ok: true,
          verified: true,
          status: 'verified',
          statusCode: 200,
          message: 'Vehicle verified successfully',
          messageCode: 'success',
          rawResponse: { success: true, data: { rc_number: vehicleNumber } },
          data: { rc_number: vehicleNumber },
          verifiedAt: new Date('2026-07-01T00:00:00.000Z'),
          source: 'surepass',
        };
      },
    },
    '../services/vehicleTypeCatalog.service': {
      assertVehicleTypeAllowed: async () => ({ ok: true, name: 'Truck' }),
    },
    '../middleware/permission.middleware': {
      getTransporterId: (user) => (user.userType === 'transporter' ? user.id : null),
      hasPermission: () => true,
    },
    '../utils/vehicleValidation': {
      checkVehicleHasTripHistory: async () => false,
      getVehicleAvailabilityState: async () => ({}),
      validateIndianVehicleRegistrationFormat: (raw) => ({
        normalized: raw.replace(/\s+/g, '').toUpperCase(),
      }),
    },
  });

  const req = {
    body: {
      vehicleNumber: 'MH 16 DY 6519',
      trailerType: '20ft',
    },
    user: {
      id: 'transporter-1',
      userType: 'transporter',
    },
  };
  const res = createMockRes();

  await controller.createVehicle(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 201);
  assert.equal(captured.verificationInput, 'MH16DY6519');
  assert.equal(captured.created.rcVerification.status, 'verified');
  assert.equal(res.body.data.verification.verified, true);
  assert.equal(res.body.data.verification.status, 'verified');
});

test('verifyVehicleNumber returns simplified SurePass verification result', async () => {
  const controller = loadWithMocks('../src/controllers/vehicle.controller.js', {
    '../services/surepass.service': {
      verifyRcFull: async (vehicleNumber) => ({
        ok: true,
        verified: true,
        status: 'verified',
        statusCode: 200,
        message: null,
        messageCode: 'success',
        rawResponse: { success: true, data: { rc_number: vehicleNumber } },
        data: { rc_number: vehicleNumber },
        verifiedAt: new Date('2026-07-01T00:00:00.000Z'),
        source: 'surepass',
      }),
    },
    '../utils/vehicleValidation': {
      validateIndianVehicleRegistrationFormat: (raw) => ({
        normalized: raw.replace(/\s+/g, '').toUpperCase(),
      }),
    },
  });

  const req = {
    body: { vehicleNumber: 'AB 12 CD 3456' },
    user: { id: 'transporter-1', userType: 'transporter' },
  };
  const res = createMockRes();

  await controller.verifyVehicleNumber(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.status_code, 200);
  assert.equal(res.body.message, null);
  assert.equal(res.body.message_code, 'success');
  assert.equal(res.body.isVerified, true);
});

test('admin vehicle details expose the stored RC payload', async () => {
  const controller = loadWithMocks('../src/controllers/admin.controller.js', {
    '../models/Admin': {},
    '../models/Transporter': {},
    '../models/Driver': {},
    '../models/PumpOwner': {},
    '../models/PumpStaff': {},
    '../models/CompanyUser': {},
    '../models/Customer': {},
    '../models/Trip': {},
    '../models/Vehicle': {
      findById: async () => ({
        populate() {
          return this;
        },
        _id: 'vehicle-1',
        vehicleNumber: 'MH16DY6519',
        transporterId: {
          _id: 'transporter-1',
          mobile: '9999999999',
          name: 'Alpha Transport',
          email: 'alpha@example.com',
          company: 'Alpha Logistics',
          status: 'active',
          hasAccess: true,
        },
        originalOwnerId: {
          _id: 'transporter-1',
          mobile: '9999999999',
          name: 'Alpha Transport',
          email: 'alpha@example.com',
          company: 'Alpha Logistics',
          status: 'active',
          hasAccess: true,
        },
        driverId: {
          _id: 'driver-1',
          name: 'Driver One',
          mobile: '8888888888',
          status: 'active',
        },
        ownerType: 'OWN',
        status: 'active',
        isBusy: false,
        vehicleType: 'Truck',
        trailerType: '20ft',
        documents: {},
        rcVerification: {
          verified: true,
          status: 'verified',
          source: 'surepass',
          checkedAt: new Date('2026-07-01T00:00:00.000Z'),
          statusCode: 200,
          message: 'Vehicle verified successfully',
          messageCode: 'success',
          verifiedVehicleNumber: 'MH16DY6519',
          rawResponse: {
            success: true,
            data: {
              rc_number: 'MH16DY6519',
              owner_name: 'Test Owner',
            },
          },
        },
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    },
    '../models/VehicleRouteAvailability': {},
    '../models/VehicleRouteAssignment': {},
    '../models/VehicleBooking': {},
    '../models/FuelTransaction': {},
    '../models/Settlement': {},
    '../models/Wallet': {},
    '../models/SystemConfig': {},
    '../models/AdminAuditLog': {},
    '../models/AuditLog': {},
    '../models/SavedLocation': {},
    '../services/jwt.service': { generateTokens: () => ({}) },
    '../utils/tripState': { TRIP_STATUS: {}, CLOSED_TRIP_STATUSES: [] },
    '../utils/tripResourceState': {
      releaseTripResources: async () => {},
      syncTripResourceBusyState: async () => {},
    },
    '../services/adminAudit.service': { logAdminAction: async () => {} },
    '../services/socket.service': {
      emitTripAssigned: () => {},
      emitTripVehicleAssigned: () => {},
      emitTripDriverAssigned: () => {},
      emitTripCancelled: () => {},
      emitTripClosedWithoutPOD: () => {},
    },
    '../utils/validation': { validateEmail: () => true, normalizeEmail: (value) => value },
  });

  const req = {
    params: { id: 'vehicle-1' },
    user: { id: 'admin-1', userType: 'admin' },
  };
  const res = createMockRes();

  await controller.getVehicleAdminDetails(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.vehicle.vehicleNumber, 'MH16DY6519');
  assert.equal(res.body.data.vehicle.rcVerification.verified, true);
  assert.equal(res.body.data.vehicle.rcVerification.rawResponse.data.owner_name, 'Test Owner');
});
