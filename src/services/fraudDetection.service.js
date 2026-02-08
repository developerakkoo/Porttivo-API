const FuelTransaction = require('../models/FuelTransaction');
const Driver = require('../models/Driver');

/**
 * Calculate distance between two GPS coordinates (Haversine formula)
 * @param {Number} lat1 - Latitude 1
 * @param {Number} lon1 - Longitude 1
 * @param {Number} lat2 - Latitude 2
 * @param {Number} lon2 - Longitude 2
 * @returns {Number} Distance in kilometers
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Check for duplicate receipt attempts
 * @param {String} driverId - Driver ID
 * @param {String} receiptPhoto - Receipt photo URL
 * @param {String} transactionId - Current transaction ID (to exclude)
 * @returns {Promise<Boolean>} True if duplicate found
 */
const checkDuplicateReceipt = async (driverId, receiptPhoto, transactionId) => {
  try {
    // Check for transactions with same receipt photo from same driver
    const duplicate = await FuelTransaction.findOne({
      driverId,
      'receipt.photo': receiptPhoto,
      _id: { $ne: transactionId },
      status: { $in: ['completed', 'confirmed'] },
    });

    return !!duplicate;
  } catch (error) {
    console.error('Error checking duplicate receipt:', error);
    return false;
  }
};

/**
 * Check GPS mismatch
 * @param {Number} transactionLat - Transaction latitude
 * @param {Number} transactionLon - Transaction longitude
 * @param {Number} pumpLat - Pump latitude
 * @param {Number} pumpLon - Pump longitude
 * @param {Number} threshold - Distance threshold in km (default 5km)
 * @returns {Object} { isMismatch: Boolean, distance: Number }
 */
const checkGPSMismatch = (transactionLat, transactionLon, pumpLat, pumpLon, threshold = 5) => {
  const distance = calculateDistance(transactionLat, transactionLon, pumpLat, pumpLon);
  return {
    isMismatch: distance > threshold,
    distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
  };
};

/**
 * Check for express uploads by single driver
 * @param {String} driverId - Driver ID
 * @param {Number} timeWindowMinutes - Time window in minutes (default 10)
 * @param {Number} threshold - Number of uploads threshold (default 3)
 * @returns {Promise<Boolean>} True if express uploads detected
 */
const checkExpressUploads = async (driverId, timeWindowMinutes = 10, threshold = 3) => {
  try {
    const timeWindow = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

    const recentUploads = await FuelTransaction.countDocuments({
      driverId,
      'receipt.uploadedAt': { $gte: timeWindow },
      status: 'completed',
    });

    return recentUploads >= threshold;
  } catch (error) {
    console.error('Error checking express uploads:', error);
    return false;
  }
};

/**
 * Check for unusual transaction patterns
 * @param {String} driverId - Driver ID
 * @param {Number} amount - Transaction amount
 * @returns {Promise<Boolean>} True if unusual pattern detected
 */
const checkUnusualPattern = async (driverId, amount) => {
  try {
    // Get driver's transaction history
    const recentTransactions = await FuelTransaction.find({
      driverId,
      status: 'completed',
      createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('amount');

    if (recentTransactions.length < 3) {
      return false; // Not enough data to detect patterns
    }

    // Calculate average and standard deviation
    const amounts = recentTransactions.map((t) => t.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const variance = amounts.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);

    // Check if current amount is more than 2 standard deviations from mean
    const zScore = Math.abs(amount - avg) / (stdDev || 1);
    return zScore > 2;
  } catch (error) {
    console.error('Error checking unusual pattern:', error);
    return false;
  }
};

/**
 * Run all fraud detection checks for a transaction
 * @param {Object} transaction - Fuel transaction object
 * @param {Object} pumpLocation - Pump location { latitude, longitude }
 * @returns {Promise<Object>} Fraud flags object
 */
const runFraudChecks = async (transaction, pumpLocation) => {
  const fraudFlags = {
    duplicateReceipt: false,
    gpsMismatch: false,
    gpsMismatchDistance: null,
    expressUploads: false,
    unusualPattern: false,
  };

  try {
    // Check duplicate receipt (if receipt is uploaded)
    if (transaction.receipt && transaction.receipt.photo) {
      fraudFlags.duplicateReceipt = await checkDuplicateReceipt(
        transaction.driverId.toString(),
        transaction.receipt.photo,
        transaction._id.toString()
      );
    }

    // Check GPS mismatch
    if (pumpLocation && transaction.location) {
      const gpsCheck = checkGPSMismatch(
        transaction.location.latitude,
        transaction.location.longitude,
        pumpLocation.latitude,
        pumpLocation.longitude
      );
      fraudFlags.gpsMismatch = gpsCheck.isMismatch;
      fraudFlags.gpsMismatchDistance = gpsCheck.distance;
    }

    // Check express uploads
    fraudFlags.expressUploads = await checkExpressUploads(transaction.driverId.toString());

    // Check unusual pattern
    if (transaction.amount) {
      fraudFlags.unusualPattern = await checkUnusualPattern(transaction.driverId.toString(), transaction.amount);
    }

    return fraudFlags;
  } catch (error) {
    console.error('Error running fraud checks:', error);
    return fraudFlags;
  }
};

/**
 * Get fraud statistics
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Fraud statistics
 */
const getFraudStatistics = async (filters = {}) => {
  try {
    const query = {
      'fraudFlags.resolved': false,
    };

    if (filters.startDate) {
      query.createdAt = { $gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      query.createdAt = { ...query.createdAt, $lte: new Date(filters.endDate) };
    }

    const [
      totalFlagged,
      duplicateReceipt,
      gpsMismatch,
      expressUploads,
      unusualPattern,
    ] = await Promise.all([
      FuelTransaction.countDocuments({
        ...query,
        $or: [
          { 'fraudFlags.duplicateReceipt': true },
          { 'fraudFlags.gpsMismatch': true },
          { 'fraudFlags.expressUploads': true },
          { 'fraudFlags.unusualPattern': true },
        ],
      }),
      FuelTransaction.countDocuments({ ...query, 'fraudFlags.duplicateReceipt': true }),
      FuelTransaction.countDocuments({ ...query, 'fraudFlags.gpsMismatch': true }),
      FuelTransaction.countDocuments({ ...query, 'fraudFlags.expressUploads': true }),
      FuelTransaction.countDocuments({ ...query, 'fraudFlags.unusualPattern': true }),
    ]);

    return {
      totalFlagged,
      byType: {
        duplicateReceipt,
        gpsMismatch,
        expressUploads,
        unusualPattern,
      },
    };
  } catch (error) {
    console.error('Error getting fraud statistics:', error);
    throw error;
  }
};

module.exports = {
  calculateDistance,
  checkDuplicateReceipt,
  checkGPSMismatch,
  checkExpressUploads,
  checkUnusualPattern,
  runFraudChecks,
  getFraudStatistics,
};
