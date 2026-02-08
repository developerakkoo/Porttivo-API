const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');

/**
 * Check if vehicle has active trip
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Boolean>} True if vehicle has active trip
 */
const checkVehicleHasActiveTrip = async (vehicleId) => {
  try {
    const activeTrip = await Trip.findOne({
      vehicleId,
      status: 'ACTIVE',
    });
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
 * @param {String} vehicleId - Vehicle ID
 * @returns {Promise<Number>} Number of queued trips
 */
const getQueuedTripsCount = async (vehicleId) => {
  try {
    const queuedTripsCount = await Trip.countDocuments({
      vehicleId,
      status: 'PLANNED',
    });
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
        message: 'Vehicle already exists as OWN. You can add it as HIRED instead.',
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
 * Check if vehicle number can be created as HIRED
 * @param {String} vehicleNumber - Vehicle number
 * @param {String} transporterId - Transporter ID
 * @returns {Promise<Object>} Validation result
 */
const canCreateAsHired = async (vehicleNumber, transporterId) => {
  try {
    const cleanedNumber = vehicleNumber.trim().toUpperCase();

    // Check if OWN vehicle exists
    const ownVehicle = await Vehicle.findOne({
      vehicleNumber: cleanedNumber,
      ownerType: 'OWN',
    });

    if (!ownVehicle) {
      return {
        canCreate: false,
        message: 'Cannot add as HIRED. Vehicle must first be registered as OWN by another transporter.',
      };
    }

    // Check if transporter already has this as HIRED
    const existingHired = await Vehicle.findOne({
      vehicleNumber: cleanedNumber,
      transporterId: transporterId,
      ownerType: 'HIRED',
    });

    if (existingHired) {
      return {
        canCreate: false,
        message: 'You have already added this vehicle as HIRED',
        existingVehicle: existingHired,
      };
    }

    return {
      canCreate: true,
      originalOwnerId: ownVehicle.transporterId,
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
