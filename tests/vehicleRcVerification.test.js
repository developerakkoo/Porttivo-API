const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadWithMocks } = require('./helpers/loadWithMocks');
const { createMockRes } = require('./helpers/http');

const vehicleControllerPath = path.resolve(
  process.cwd(),
  'src/controllers/vehicle.controller.js'
);
const surepassServicePath = path.resolve(
  process.cwd(),
  'src/services/surepass.service.js'
);
const adminControllerPath = path.resolve(
  process.cwd(),
  'src/controllers/admin.controller.js'
);

const createVehicleWithVerification = async verifyRcFull => {
  const captured = { created: null, verificationInput: null };
  const controller = loadWithMocks(vehicleControllerPath, {
    '../models/Vehicle': {
      findOne: query =>
        query?.driverId
          ? { select: async () => null }
          : Promise.resolve(null),
      create: async payload => {
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
      findOne: async () => ({
        _id: 'driver-1',
        transporterId: 'transporter-1',
        status: 'active',
      }),
      findOneAndUpdate: async (filter, update) => ({
        _id: filter._id,
        ...update.$set,
      }),
      updateOne: async () => ({ modifiedCount: 1 }),
    },
    '../services/surepass.service': {
      verifyRcFull: async vehicleNumber => {
        captured.verificationInput = vehicleNumber;
        return verifyRcFull(vehicleNumber);
      },
    },
    '../services/vehicleTypeCatalog.service': {
      assertVehicleTypeAllowed: async () => ({ ok: true, name: 'Truck' }),
    },
    '../middleware/permission.middleware': {
      getTransporterId: user =>
        user.userType === 'transporter' ? user.id : null,
      hasPermission: () => true,
    },
    '../utils/vehicleValidation': {
      checkVehicleHasTripHistory: async () => false,
      getVehicleAvailabilityState: async () => ({}),
      validateIndianVehicleRegistrationFormat: raw => ({
        normalized: raw.replace(/\s+/g, '').toUpperCase(),
      }),
    },
  });
  const res = createMockRes();

  await controller.createVehicle(
    {
      body: {
        vehicleNumber: 'MH 16 DY 6519',
        vehicleType: 'Truck',
        driverId: 'driver-1',
        trailerType: '20ft',
        cargoWeightMt: 25.5,
      },
      user: { id: 'transporter-1', userType: 'transporter' },
    },
    res,
    error => {
      throw error;
    }
  );

  return { captured, res };
};

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

    const { verifyRcFull } = loadWithMocks(surepassServicePath, {
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

test('createVehicle saves a vehicle when SurePass verifies the RC', async () => {
  const { captured, res } = await createVehicleWithVerification(vehicleNumber => ({
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
  }));

  assert.equal(res.statusCode, 201);
  assert.equal(captured.verificationInput, 'MH16DY6519');
  assert.equal(captured.created.cargoWeightMt, 25.5);
  assert.equal(captured.created.rcVerification.status, 'verified');
  assert.equal(res.body.data.vehicle.cargoWeightMt, 25.5);
  assert.equal(res.body.data.verification.verified, true);
  assert.equal(res.body.data.verification.status, 'verified');
});

const nonBlockingVerificationCases = [
  {
    name: 'not_verified',
    verification: () => ({
      ok: true,
      verified: false,
      status: 'not_verified',
      statusCode: 200,
      message: 'No matching RC record',
      rawResponse: { internal_provider_detail: 'not exposed' },
      source: 'surepass',
    }),
    expectedStatus: 'not_verified',
  },
  {
    name: 'server or network error',
    verification: () => ({
      ok: false,
      verified: false,
      status: 'error',
      statusCode: 503,
      message: 'Surepass upstream connection refused',
      rawResponse: { token: 'must-not-be-exposed' },
      source: 'surepass',
    }),
    expectedStatus: 'error',
  },
  {
    name: 'timeout',
    verification: () => ({
      ok: false,
      verified: false,
      status: 'timeout',
      message: 'Surepass request timed out',
      source: 'surepass',
    }),
    expectedStatus: 'timeout',
  },
  {
    name: '401 or 403 token error',
    verification: () => ({
      ok: false,
      verified: false,
      status: 'error',
      statusCode: 401,
      message: 'Surepass token rejected',
      rawResponse: { authorization: 'Bearer must-not-be-exposed' },
      source: 'surepass',
    }),
    expectedStatus: 'error',
  },
];

for (const scenario of nonBlockingVerificationCases) {
  test(`createVehicle saves a vehicle when SurePass returns ${scenario.name}`, async () => {
    const { captured, res } = await createVehicleWithVerification(scenario.verification);

    assert.equal(res.statusCode, 201);
    assert.equal(captured.created.rcVerification.status, scenario.expectedStatus);
    assert.equal(captured.created.rcVerification.rawResponse, null);
    assert.equal(res.body.data.vehicle.rcVerification.rawResponse, null);
    assert.equal(JSON.stringify(res.body).includes('must-not-be-exposed'), false);
  });
}

test('createVehicle saves a vehicle when SurePass throws unexpectedly', async () => {
  const { captured, res } = await createVehicleWithVerification(() => {
    throw new Error('Surepass token must-not-be-exposed');
  });

  assert.equal(res.statusCode, 201);
  assert.equal(captured.created.rcVerification.status, 'error');
  assert.equal(captured.created.rcVerification.rawResponse, null);
  assert.equal(res.body.data.verification.message, 'Vehicle verification is currently unavailable');
  assert.equal(JSON.stringify(res.body).includes('must-not-be-exposed'), false);
});

test('verifyVehicleNumber returns simplified SurePass verification result', async () => {
  const controller = loadWithMocks(vehicleControllerPath, {
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

test('verifyVehicleNumber returns HTTP 200 when SurePass token is expired without returning 401', async () => {
  const controller = loadWithMocks(vehicleControllerPath, {
    '../services/surepass.service': {
      verifyRcFull: async () => ({
        ok: false,
        verified: false,
        status: 'error',
        statusCode: 401,
        message: 'Your token is expired.This was a temporary token to test the account, please consider upgrading to a paid subscription. Please contact support for help.',
        rawResponse: { success: false, message: 'Your token is expired' },
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
    body: { vehicleNumber: 'MH 12 AB 1234' },
    user: { id: 'transporter-1', userType: 'transporter' },
  };
  const res = createMockRes();

  await controller.verifyVehicleNumber(req, res, (error) => {
    throw error;
  });

  // Must be 200, never 401, so client authentication is NOT invalidated
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, false);
  assert.equal(res.body.status_code, 200);
  assert.equal(res.body.isVerified, false);
  assert.equal(res.body.message, 'Vehicle verification is currently unavailable. You can still proceed to add the vehicle.');
  assert.equal(res.body.message_code, 'verification_unavailable');
  assert.equal(JSON.stringify(res.body).includes('Your token is expired'), false);
});

test('verifyVehicleNumber returns HTTP 200 when SurePass times out or is down', async () => {
  const controller = loadWithMocks(vehicleControllerPath, {
    '../services/surepass.service': {
      verifyRcFull: async () => ({
        ok: false,
        verified: false,
        status: 'timeout',
        statusCode: null,
        message: 'SurePass RC verification timed out',
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
    body: { vehicleNumber: 'MH 12 AB 1234' },
    user: { id: 'transporter-1', userType: 'transporter' },
  };
  const res = createMockRes();

  await controller.verifyVehicleNumber(req, res, (error) => {
    throw error;
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, false);
  assert.equal(res.body.status_code, 200);
  assert.equal(res.body.isVerified, false);
  assert.equal(res.body.message, 'Vehicle verification timed out. You can still proceed to add the vehicle.');
});

test('admin vehicle details expose the stored RC payload', async () => {
  const controller = loadWithMocks(adminControllerPath, {
    '../models/Admin': {},
    '../models/Transporter': {},
    '../models/Driver': {},
    '../models/PumpOwner': {},
    '../models/PumpStaff': {},
    '../models/CompanyUser': {},
    '../models/Customer': {},
    '../models/Trip': {},
    '../models/Vehicle': {
      findById: () => {
        const vehicle = {
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
        };
        return {
          populate() {
            return this;
          },
          then(resolve, reject) {
            return Promise.resolve(vehicle).then(resolve, reject);
          },
        };
      },
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
    params: { id: '507f191e810c19729de860ea' },
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
