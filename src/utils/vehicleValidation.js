const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const { TRIP_STATUS } = require('./tripState');

/**
 * Check if vehicle has active trip
 * @param {String|Object} vehicleSelector - Vehicle ID or query selector
 * @param {String|null} excludeTripId - Trip ID to exclude from the check
 * @returns {Promise<Boolean>} True if vehicle has active trip
 */
const checkVehicleHasActiveTrip = async (vehicleSelector, excludeTripId = null) => {
  try {
    const query =
      vehicleSelector && typeof vehicleSelector === 'object' && !Array.isArray(vehicleSelector)
        ? { ...vehicleSelector, status: TRIP_STATUS.ACTIVE }
        : { vehicleId: vehicleSelector, status: TRIP_STATUS.ACTIVE };

    if (excludeTripId) {
      query._id = { $ne: excludeTripId };
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
    const query =
      vehicleSelector && typeof vehicleSelector === 'object' && !Array.isArray(vehicleSelector)
        ? { ...vehicleSelector, status: TRIP_STATUS.PLANNED }
        : { vehicleId: vehicleSelector, status: TRIP_STATUS.PLANNED };

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
    const hasActiveTrip = await checkVehicleHasActiveTrip(vehicleId);
    const queuedTripsCount = await getQueuedTripsCount(vehicleId);
    const hasTripHistory = await checkVehicleHasTripHistory(vehicleId);

    let state = 'AVAILABLE';
    if (hasActiveTrip) {
      state = 'ACTIVE';
    } else if (queuedTripsCount > 0) {
      state = 'QUEUED';
    }

    return {
      state,
      hasActiveTrip,
      queuedTripsCount,
      hasTripHistory,
      isAvailable: !hasActiveTrip,
    };
  } catch (error) {
    console.error('Error getting vehicle availability:', error);
    return {
      state: 'UNKNOWN',
      hasActiveTrip: false,
      queuedTripsCount: 0,
      hasTripHistory: false,
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

    // Vehicle can have multiple queued trips, but only one active trip
    // So it's always valid to create a new trip (it will be queued)
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
    const cleanedNumber = vehicleNumber.trim().toUpperCase();
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
  checkVehicleHasActiveTrip,
  checkVehicleHasTripHistory,
  getQueuedTripsCount,
  getVehicleAvailabilityState,
  validateVehicleForTrip,
  canCreateAsOwn,
  canCreateAsHired,
};
