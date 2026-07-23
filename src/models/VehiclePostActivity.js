const mongoose = require('mongoose');

// 🔥 Centralized constants (prevents typo bugs)
const POST_ACTIVITY_ACTIONS = {
  CREATED: 'CREATED', // listing created (draft or active)
  ACTIVATED: 'ACTIVATED', // listing went live in search
  PAUSED: 'PAUSED', // hidden from search
  RESUMED: 'RESUMED', // un-paused
  UPDATED: 'UPDATED', // generic edit (fallback)
  QUANTITY_CHANGED: 'QUANTITY_CHANGED', // available quantity changed
  RATES_UPDATED: 'RATES_UPDATED', // one or more route rates changed
  ROUTE_ADDED: 'ROUTE_ADDED', // destination/route added
  ROUTE_REMOVED: 'ROUTE_REMOVED', // destination/route removed
  VEHICLE_ADDED: 'VEHICLE_ADDED', // fleet vehicle(s) attached
  CANCELLED: 'CANCELLED', // listing cancelled/deleted
  FULFILLED: 'FULFILLED', // fully booked (inventory exhausted)
};

const vehiclePostActivitySchema = new mongoose.Schema(
  {
    // 🔗 Listing reference (VehicleRouteAvailability)
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VehicleRouteAvailability',
      required: true,
      index: true,
    },

    // 🎯 Action type
    action: {
      type: String,
      enum: Object.values(POST_ACTIVITY_ACTIONS),
      required: true,
      index: true,
    },

    // 👤 Who performed the action (null for SYSTEM events)
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
      index: true,
    },

    // 🧾 Extra metadata (flexible), e.g. { from, to }, { destination }, { count }
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // 🔄 Before & After (for tracking changes)
    beforeValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    afterValue: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    // 📝 Optional notes
    notes: {
      type: String,
      trim: true,
      default: null,
    },

    // 📡 Source of action (API / SOCKET / SYSTEM)
    source: {
      type: String,
      enum: ['API', 'SOCKET', 'SYSTEM'],
      default: 'API',
    },
  },
  {
    timestamps: true,
  }
);

// 🚀 INDEXES

// Listing timeline queries (newest first)
vehiclePostActivitySchema.index({ postId: 1, createdAt: -1 });

// User activity tracking
vehiclePostActivitySchema.index({ performedBy: 1, createdAt: -1 });

// Action filtering
vehiclePostActivitySchema.index({ action: 1, createdAt: -1 });

// 🧠 STATIC HELPER (clean usage). Never throws — activity logging must not
// break the primary request; failures are swallowed and logged.
vehiclePostActivitySchema.statics.logAction = async function ({
  postId,
  action,
  performedBy = null,
  details = {},
  beforeValue = null,
  afterValue = null,
  notes = null,
  source = 'API',
}) {
  try {
    return await this.create({
      postId,
      action,
      performedBy,
      details,
      beforeValue,
      afterValue,
      notes,
      source,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('VehiclePostActivity.logAction failed:', err?.message || err);
    return null;
  }
};

// 🚀 EXPORT CONSTANTS + MODEL
module.exports = {
  VehiclePostActivity: mongoose.model(
    'VehiclePostActivity',
    vehiclePostActivitySchema
  ),
  POST_ACTIVITY_ACTIONS,
};
