const mongoose = require('mongoose');

// Milestone Schema
const milestoneSchema = new mongoose.Schema(
  {
    milestoneType: {
      type: String,
      enum: ['CONTAINER_PICKED', 'REACHED_LOCATION', 'LOADING_UNLOADING', 'REACHED_DESTINATION', 'TRIP_COMPLETED'],
      required: true,
    },
    milestoneNumber: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    location: {
      latitude: {
        type: Number,
        required: true,
      },
      longitude: {
        type: Number,
        required: true,
      },
    },
    photo: {
      type: String,
      default: null,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      required: true,
    },
    backendMeaning: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

// POD Schema
const podSchema = new mongoose.Schema(
  {
    photo: {
      type: String,
      default: null,
    },
    uploadedAt: {
      type: Date,
      default: null,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
    },
  },
  { _id: false }
);

// Location Schema
const locationSchema = new mongoose.Schema(
  {
    address: {
      type: String,
      trim: true,
    },
    coordinates: {
      latitude: {
        type: Number,
        required: true,
      },
      longitude: {
        type: Number,
        required: true,
      },
    },
  },
  { _id: false }
);

// Trip Schema
const tripSchema = new mongoose.Schema(
  {
    tripId: {
      type: String,
      unique: true,
      required: true,
      default: () => `TRIP-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
      index: true,
    },
    transporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      required: [true, 'Transporter ID is required'],
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      default: null,
      index: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
      index: true,
    },
    containerNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },
    reference: {
      type: String,
      trim: true,
    },
    pickupLocation: {
      type: locationSchema,
      default: null,
    },
    dropLocation: {
      type: locationSchema,
      default: null,
    },
    tripType: {
      type: String,
      enum: ['IMPORT', 'EXPORT'],
      required: [true, 'Trip type is required'],
      index: true,
    },
    status: {
      type: String,
      enum: ['PLANNED', 'ACTIVE', 'COMPLETED', 'POD_PENDING', 'CANCELLED'],
      default: 'PLANNED',
      index: true,
    },
    milestones: {
      type: [milestoneSchema],
      default: [],
    },
    POD: {
      type: podSchema,
      default: {},
    },
    shareToken: {
      type: String,
      default: null,
      index: true,
    },
    shareTokenExpiry: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
tripSchema.index({ vehicleId: 1, status: 1 });
tripSchema.index({ transporterId: 1, vehicleId: 1 });
tripSchema.index({ transporterId: 1, status: 1 });
tripSchema.index({ driverId: 1, status: 1 });
tripSchema.index({ containerNumber: 1 });
tripSchema.index({ reference: 1 });
tripSchema.index({ tripId: 1 });

// Virtual for next milestone number
tripSchema.virtual('nextMilestoneNumber').get(function () {
  return this.milestones.length + 1;
});

// Method to check if all milestones are completed
tripSchema.methods.areAllMilestonesCompleted = function () {
  return this.milestones.length === 5;
};

// Method to get current milestone
tripSchema.methods.getCurrentMilestone = function () {
  const nextNumber = this.milestones.length + 1;
  if (nextNumber > 5) {
    return null; // All milestones completed
  }
  return {
    milestoneNumber: nextNumber,
    milestoneType: this.getMilestoneTypeByNumber(nextNumber),
  };
};

// Method to get milestone type by number
tripSchema.methods.getMilestoneTypeByNumber = function (number) {
  const types = ['CONTAINER_PICKED', 'REACHED_LOCATION', 'LOADING_UNLOADING', 'REACHED_DESTINATION', 'TRIP_COMPLETED'];
  return types[number - 1];
};

module.exports = mongoose.model('Trip', tripSchema);
