const Vehicle = require('../models/Vehicle');
const Driver = require('../models/Driver');
const Trip = require('../models/Trip');
const { TRIP_STATUS } = require('./tripState');

const BUSY_TRIP_STATUSES = [
  TRIP_STATUS.ACCEPTED,
  TRIP_STATUS.PLANNED,
  TRIP_STATUS.ACTIVE,
  TRIP_STATUS.PAUSED,
];

const ACTIVE_TRIP_STATUSES = [TRIP_STATUS.ACTIVE, TRIP_STATUS.PAUSED];

const buildResourceTripQuery = (resourceField, resourceId, statuses, excludeTripId = null) => {
  const assignmentField =
    resourceField === 'vehicleId' ? 'assignments.vehicleId' : 'assignments.driverId';
  const query = {
    status: { $in: statuses },
    $or: [{ [resourceField]: resourceId }, { [assignmentField]: resourceId }],
  };
  if (excludeTripId) {
    query._id = { $ne: excludeTripId };
  }
  return query;
};

/** Indian vehicle registration: 2 letters + 2 digits + 1-2 letters (series) + 4 digits (9 or 10 chars), e.g. MH01A1234 or MH12AB3434 */
const INDIAN_VEHICLE_REGISTRATION_RE = /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/;

/**
 * Normalize Indian registration: remove whitespace, uppercase.
 * @param {string|null|undefined} raw
 * @returns {string}
 */
const normalizeIndianVehicleRegistration = (raw) => {
  if (raw == null || typeof raw !== 'string') return '';
  return raw.replace(/\s+/g, '').trim().toUpperCase();
};

/**
 * @param {string} normalized - output of normalizeIndianVehicleRegistration
 * @returns {boolean}
 */
const isValidIndianVehicleRegistration = (normalized) =>
  typeof normalized === 'string' &&
  (normalized.length === 9 || normalized.length === 10) &&
  INDIAN_VEHICLE_REGISTRATION_RE.test(normalized);

/**
 * @param {string|null|undefined} raw
 * @returns {{ normalized: string }|{ error: string }}
 */
const validateIndianVehicleRegistrationFormat = (raw) => {
  const normalized = normalizeIndianVehicleRegistration(raw);
  if (!normalized) {
    return { error: 'Vehicle number is required' };
  }
  if (!isValidIndianVehicleRegistration(normalized)) {
    return {
      error:
        'Invalid vehicle registration. Use 9 or 10 characters: 2 letters (state), 2 digits, 1-2 letters (series), 4 digits (e.g. MH01A1234 or MH12AB3434).',
    };
  }
  return { normalized };
};

/**
 * Check if vehicle has active trip
 * @param {String|Object} vehicleSelector - Vehicle ID or query selector
 * @param {String|null} excludeTripId - Trip ID to exclude from the check
 * @returns {Promise<Boolean>} True if vehicle has active trip
 */
const checkVehicleHasActiveTrip = async (vehicleSelector, excludeTripId = null) => {
  try {
    let query;
    if (
      vehicleSelector &&
      typeof vehicleSelector === 'object' &&
      !Array.isArray(vehicleSelector)
    ) {
      query = { ...vehicleSelector, status: { $in: ACTIVE_TRIP_STATUSES } };
      if (excludeTripId) {
        query._id = { $ne: excludeTripId };
      }
    } else {
      query = buildResourceTripQuery(
        'vehicleId',
        vehicleSelector,
        ACTIVE_TRIP_STATUSES,
        excludeTripId
      );
    }

    const activeTrip = await Trip.findOne(query);
    return !!activeTrip;
  } catch (error) {
    console.error('Error checking active trip:', error);
    return false;
  }
};

/**
 * Check if vehicle has trip history
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Boolean>} True if vehicle has any trip history
 */
const checkVehicleHasTripHistory = async (vehicleId) => {
  try {
    const tripCount = await Trip.countDocuments({ vehicleId });
    return tripCount > 0;
  } catch (error) {
    console.error('Error checking trip history:', error);
    return false;
  }
};

/**
 * Check if vehicle has queued trips
 * @param {String|Object} vehicleSelector - Vehicle ID or query selector
 * @returns {Promise<Number>} Number of queued trips
 */
const getQueuedTripsCount = async (vehicleSelector) => {
  try {
    let query;
    if (
      vehicleSelector &&
      typeof vehicleSelector === 'object' &&
      !Array.isArray(vehicleSelector)
    ) {
      query = { ...vehicleSelector, status: TRIP_STATUS.PLANNED };
    } else {
      query = buildResourceTripQuery('vehicleId', vehicleSelector, [TRIP_STATUS.PLANNED]);
    }

    const queuedTripsCount = await Trip.countDocuments(query);
    return queuedTripsCount;
  } catch (error) {
    console.error('Error checking queued trips:', error);
    return 0;
  }
};

/**
 * Get vehicle availability state
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Object>} Availability state object
 */
const getVehicleAvailabilityState = async (vehicleId) => {
  try {
    const vehicle = await Vehicle.findById(vehicleId).select('isBusy status');
    if (!vehicle) {
      return {
        state: 'UNKNOWN',
        hasActiveTrip: false,
        hasOccupiedTrip: false,
        queuedTripsCount: 0,
        hasTripHistory: false,
        isBusy: false,
        isAvailable: false,
      };
    }

    const hasActiveTrip = await checkVehicleHasActiveTrip(vehicleId);
    const hasOccupiedTrip = await checkVehicleHasAssignedTrip(vehicleId);
    const queuedTripsCount = await getQueuedTripsCount(vehicleId);
    const hasTripHistory = await checkVehicleHasTripHistory(vehicleId);
    const isBusy = !!vehicle.isBusy || hasOccupiedTrip || hasActiveTrip;

    let state = 'AVAILABLE';
    if (isBusy) {
      state = 'BUSY';
    } else if (queuedTripsCount > 0) {
      state = 'QUEUED';
    }

    return {
      state,
      hasActiveTrip,
      hasOccupiedTrip,
      queuedTripsCount,
      hasTripHistory,
      isBusy,
      isAvailable: !isBusy,
    };
  } catch (error) {
    console.error('Error getting vehicle availability:', error);
    return {
      state: 'UNKNOWN',
      hasActiveTrip: false,
      hasOccupiedTrip: false,
      queuedTripsCount: 0,
      hasTripHistory: false,
      isBusy: false,
      isAvailable: false,
    };
  }
};

/**
 * Check if vehicle has an assigned trip that is not yet completed
 * @param {String|Object} vehicleSelector - Vehicle ID or query selector
 * @param {String|null} excludeTripId - Trip ID to exclude from the check
 * @returns {Promise<Boolean>} True if vehicle has an assigned trip
 */
const checkVehicleHasAssignedTrip = async (vehicleSelector, excludeTripId = null) => {
  try {
    let query;
    if (
      vehicleSelector &&
      typeof vehicleSelector === 'object' &&
      !Array.isArray(vehicleSelector)
    ) {
      query = { ...vehicleSelector, status: { $in: BUSY_TRIP_STATUSES } };
      if (excludeTripId) {
        query._id = { $ne: excludeTripId };
      }
    } else {
      query = buildResourceTripQuery(
        'vehicleId',
        vehicleSelector,
        BUSY_TRIP_STATUSES,
        excludeTripId
      );
    }

    const assignedTrip = await Trip.findOne(query);
    return !!assignedTrip;
  } catch (error) {
    console.error('Error checking assigned trip:', error);
    return false;
  }
};

const checkDriverHasAssignedTrip = async (driverId, excludeTripId = null) => {
  try {
    const query = buildResourceTripQuery(
      'driverId',
      driverId,
      BUSY_TRIP_STATUSES,
      excludeTripId
    );
    const assignedTrip = await Trip.findOne(query);
    return !!assignedTrip;
  } catch (error) {
    console.error('Error checking driver assigned trip:', error);
    return false;
  }
};

const getDriverAvailabilityState = async (driverId, excludeTripId = null) => {
  try {
    const driver = await Driver.findById(driverId).select('isBusy status');
    if (!driver) {
      return {
        state: 'UNKNOWN',
        hasOccupiedTrip: false,
        isBusy: true,
        isAvailable: false,
      };
    }

    const hasOccupiedTrip = await checkDriverHasAssignedTrip(driverId, excludeTripId);
    const isBusy =
      hasOccupiedTrip || (excludeTripId ? false : !!driver.isBusy) || driver.status !== 'active';

    return {
      state: isBusy ? 'BUSY' : 'AVAILABLE',
      hasOccupiedTrip,
      isBusy,
      isAvailable: !isBusy && driver.status === 'active',
    };
  } catch (error) {
    console.error('Error getting driver availability:', error);
    return {
      state: 'UNKNOWN',
      hasOccupiedTrip: false,
      isBusy: true,
      isAvailable: false,
    };
  }
};

/**
 * Validate vehicle can be used for new trip
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Object>} Validation result
 */
const validateVehicleForTrip = async (vehicleId) => {
  try {
    const vehicle = await Vehicle.findById(vehicleId);
    if (!vehicle) {
      return {
        valid: false,
        message: 'Vehicle not found',
      };
    }

    if (vehicle.status !== 'active') {
      return {
        valid: false,
        message: 'Vehicle is not active',
      };
    }

    const availability = await getVehicleAvailabilityState(vehicleId);

    if (availability.isBusy) {
      return {
        valid: false,
        message: 'Vehicle is already assigned to another trip. Please complete or cancel the current trip first.',
      };
    }

    return {
      valid: true,
      availability,
    };
  } catch (error) {
    console.error('Error validating vehicle for trip:', error);
    return {
      valid: false,
      message: 'Error validating vehicle',
    };
  }
};

/**
 * Check if vehicle number can be created as OWN
 * @param {String} vehicleNumber - Vehicle number
 * @returns {Promise<Object>} Validation result
 */
const canCreateAsOwn = async (vehicleNumber) => {
  try {
    const cleanedNumber = normalizeIndianVehicleRegistration(vehicleNumber);
    const existingOwn = await Vehicle.findOne({
      vehicleNumber: cleanedNumber,
      ownerType: 'OWN',
    });

    if (existingOwn) {
      return {
        canCreate: false,
        message: 'Vehicle already exists as OWN.',
        existingVehicle: existingOwn,
      };
    }

    return {
      canCreate: true,
    };
  } catch (error) {
    console.error('Error checking OWN vehicle:', error);
    return {
      canCreate: false,
      message: 'Error checking vehicle',
    };
  }
};

/**
 * Hired vehicles are trip-scoped and should not be created in fleet
 * @param {String} vehicleNumber - Vehicle number
 * @param {String} transporterId - Transporter ID
 * @returns {Promise<Object>} Validation result
 */
const canCreateAsHired = async (vehicleNumber, transporterId) => {
  try {
    return {
      canCreate: false,
      message: 'Hired vehicles are one-time only. Assign them directly on the trip instead of creating them in fleet.',
    };
  } catch (error) {
    console.error('Error checking HIRED vehicle:', error);
    return {
      canCreate: false,
      message: 'Error checking vehicle',
    };
  }
};

module.exports = {
  normalizeIndianVehicleRegistration,
  isValidIndianVehicleRegistration,
  validateIndianVehicleRegistrationFormat,
  BUSY_TRIP_STATUSES,
  buildResourceTripQuery,
  checkVehicleHasActiveTrip,
  checkVehicleHasAssignedTrip,
  checkDriverHasAssignedTrip,
  checkVehicleHasTripHistory,
  getQueuedTripsCount,
  getVehicleAvailabilityState,
  getDriverAvailabilityState,
  validateVehicleForTrip,
  canCreateAsOwn,
  canCreateAsHired,
};
