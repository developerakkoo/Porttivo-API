/**
 * Backend meaning mapping for unified milestones
 * Maps milestone types to their operational meaning based on trip type (IMPORT/EXPORT)
 */

const MILESTONE_MEANINGS = {
  CONTAINER_PICKED: {
    EXPORT: 'Empty container picked from CFS / yard',
    IMPORT: 'Loaded container picked from port / terminal',
  },
  REACHED_LOCATION: {
    EXPORT: 'Reached factory for loading',
    IMPORT: 'Reached factory / warehouse for unloading',
  },
  LOADING_UNLOADING: {
    EXPORT: 'Loading completed and vehicle exited factory',
    IMPORT: 'Unloading completed and vehicle exited warehouse',
  },
  REACHED_DESTINATION: {
    EXPORT: 'Reached port',
    IMPORT: 'Reached empty yard / CFS',
  },
  TRIP_COMPLETED: {
    EXPORT: 'Container gate-in completed',
    IMPORT: 'Empty container offloaded',
  },
};

/**
 * Get backend meaning for a milestone based on trip type
 * @param {string} milestoneType - The milestone type (CONTAINER_PICKED, etc.)
 * @param {string} tripType - The trip type (IMPORT or EXPORT)
 * @returns {string} Backend meaning string
 */
function getBackendMeaning(milestoneType, tripType) {
  if (!MILESTONE_MEANINGS[milestoneType]) {
    throw new Error(`Invalid milestone type: ${milestoneType}`);
  }
  if (!MILESTONE_MEANINGS[milestoneType][tripType]) {
    throw new Error(`Invalid trip type: ${tripType}`);
  }
  return MILESTONE_MEANINGS[milestoneType][tripType];
}

/**
 * Get driver-friendly milestone label (same for all trip types)
 * @param {string} milestoneType - The milestone type
 * @returns {string} Driver-friendly label
 */
function getDriverLabel(milestoneType) {
  const labels = {
    CONTAINER_PICKED: 'Container Pick up',
    REACHED_LOCATION: 'Reached Location',
    LOADING_UNLOADING: 'Loading / Unloading',
    REACHED_DESTINATION: 'Reached Destination',
    TRIP_COMPLETED: 'Trip Completed',
  };
  return labels[milestoneType] || milestoneType;
}

/**
 * Get milestone type by number (1-5)
 * @param {number} milestoneNumber - Milestone number (1-5)
 * @returns {string} Milestone type
 */
function getMilestoneTypeByNumber(milestoneNumber) {
  const types = ['CONTAINER_PICKED', 'REACHED_LOCATION', 'LOADING_UNLOADING', 'REACHED_DESTINATION', 'TRIP_COMPLETED'];
  if (milestoneNumber < 1 || milestoneNumber > 5) {
    throw new Error(`Invalid milestone number: ${milestoneNumber}. Must be between 1 and 5.`);
  }
  return types[milestoneNumber - 1];
}

/**
 * Get milestone number by type
 * @param {string} milestoneType - Milestone type
 * @returns {number} Milestone number (1-5)
 */
function getMilestoneNumberByType(milestoneType) {
  const types = ['CONTAINER_PICKED', 'REACHED_LOCATION', 'LOADING_UNLOADING', 'REACHED_DESTINATION', 'TRIP_COMPLETED'];
  const index = types.indexOf(milestoneType);
  if (index === -1) {
    throw new Error(`Invalid milestone type: ${milestoneType}`);
  }
  return index + 1;
}

module.exports = {
  getBackendMeaning,
  getDriverLabel,
  getMilestoneTypeByNumber,
  getMilestoneNumberByType,
  MILESTONE_MEANINGS,
};
