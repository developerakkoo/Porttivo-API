const mongoose = require('mongoose');
const { TRIP_STATUS, TRIP_STATUS_VALUES, BOOKING_STATUS_VALUES } = require('../utils/tripState');

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
    city: {
      type: String,
      trim: true,
      default: null,
    },
    state: {
      type: String,
      trim: true,
      default: null,
    },
    pincode: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false }
);

const hiredVehicleSchema = new mongoose.Schema(
  {
    vehicleNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    trailerType: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { _id: false }
);

const actorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    userType: {
      type: String,
      enum: ['TRANSPORTER', 'CUSTOMER', 'DRIVER', 'COMPANY_USER', 'ADMIN', 'SYSTEM'],
      default: null,
    },
  },
  { _id: false }
);

const shareConfigSchema = new mongoose.Schema(
  {
    enabled: {
      type: Boolean,
      default: false,
    },
    linkType: {
      type: String,
      enum: ['TRIP_VISIBILITY', 'ORIGIN_PICKUP'],
      default: 'TRIP_VISIBILITY',
    },
    visibilityMode: {
      type: String,
      enum: ['STATUS_ONLY', 'FULL_EXECUTION'],
      default: 'STATUS_ONLY',
    },
    token: {
      type: String,
      default: null,
      index: true,
    },
    expiresAt: {
      type: Date,
      default: null,
    },
    sharedAt: {
      type: Date,
      default: null,
    },
    sharedBy: {
      type: actorSchema,
      default: () => ({}),
    },
  },
  { _id: false }
);

const photoRulesSchema = new mongoose.Schema(
  {
    containerPickedRequired: {
      type: Boolean,
      default: false,
    },
    reachedLocationRequired: {
      type: Boolean,
      default: false,
    },
    loadingUnloadingRequired: {
      type: Boolean,
      default: false,
    },
    reachedDestinationRequired: {
      type: Boolean,
      default: false,
    },
    tripCompletedRequired: {
      type: Boolean,
      default: false,
    },
    podRequiredForBillable: {
      type: Boolean,
      default: true,
    },
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: TRIP_STATUS_VALUES,
      required: true,
    },
    changedAt: {
      type: Date,
      default: Date.now,
    },
    changedBy: {
      type: actorSchema,
      default: () => ({}),
    },
    note: {
      type: String,
      trim: true,
      default: null,
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
      required: function () {
        return this.bookedBy !== 'CUSTOMER';
      },
      default: null,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
    },
    vehicleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vehicle',
      default: null,
      index: true,
    },
    hiredVehicle: {
      type: hiredVehicleSchema,
      default: null,
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
    bookedBy: {
      type: String,
      enum: ['TRANSPORTER', 'CUSTOMER'],
      default: 'TRANSPORTER',
      index: true,
    },
    bookingStatus: {
      type: String,
      enum: BOOKING_STATUS_VALUES,
      default: null,
      index: true,
    },
    acceptedTransporterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transporter',
      default: null,
      index: true,
    },
    rejectedTransporterIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transporter',
      },
    ],
    acceptedAt: {
      type: Date,
      default: null,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    customerName: {
      type: String,
      trim: true,
      default: null,
    },
    customerMobile: {
      type: String,
      trim: true,
      default: null,
    },
    customerOwnership: {
      ownerType: {
        type: String,
        enum: ['CUSTOMER_MANAGED', 'TRANSPORTER_MANAGED'],
        default: 'TRANSPORTER_MANAGED',
      },
      payerType: {
        type: String,
        enum: ['CUSTOMER', 'TRANSPORTER', 'THIRD_PARTY', 'UNKNOWN'],
        default: 'UNKNOWN',
      },
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    loadType: {
      type: String,
      trim: true,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      default: null,
    },
    status: {
      type: String,
      enum: TRIP_STATUS_VALUES,
      default: TRIP_STATUS.PLANNED,
      index: true,
    },
    closureStatus: {
      type: String,
      enum: ['OPEN', 'POD_PENDING', 'CLOSED_WITH_POD', 'CLOSED_WITHOUT_POD', 'CANCELLED'],
      default: 'OPEN',
      index: true,
    },
    visibilityMode: {
      type: String,
      enum: ['FULL_EXECUTION', 'STATUS_ONLY'],
      default: 'FULL_EXECUTION',
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    podTimerStartedAt: {
      type: Date,
      default: null,
    },
    podDueAt: {
      type: Date,
      default: null,
      index: true,
    },
    podWindowHours: {
      type: Number,
      default: 72,
      min: 1,
    },
    closedAt: {
      type: Date,
      default: null,
    },
    closedReason: {
      type: String,
      trim: true,
      default: null,
    },
    milestones: {
      type: [milestoneSchema],
      default: [],
    },
    queueSequence: {
      type: Number,
      default: null,
      min: 1,
    },
    queuedAt: {
      type: Date,
      default: null,
    },
    activatedAt: {
      type: Date,
      default: null,
    },
    photoRules: {
      type: photoRulesSchema,
      default: () => ({}),
    },
    POD: {
      type: podSchema,
      default: {},
    },
    shareConfig: {
      type: shareConfigSchema,
      default: () => ({}),
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
    audit: {
      createdBy: {
        type: actorSchema,
        default: () => ({}),
      },
      updatedBy: {
        type: actorSchema,
        default: () => ({}),
      },
      acceptedBy: {
        type: actorSchema,
        default: () => ({}),
      },
      lastStatusChangedAt: {
        type: Date,
        default: Date.now,
      },
      statusHistory: {
        type: [statusHistorySchema],
        default: [],
      },
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
tripSchema.index({ customerId: 1, createdAt: -1 });
tripSchema.index({ bookedBy: 1, bookingStatus: 1, status: 1 });
tripSchema.index({ acceptedTransporterId: 1, status: 1 });
tripSchema.index({ 'hiredVehicle.vehicleNumber': 1, status: 1 });
tripSchema.index({ visibilityMode: 1, status: 1 });
tripSchema.index({ closureStatus: 1, status: 1 });
tripSchema.index({ queueSequence: 1, queuedAt: 1 });
tripSchema.index({ containerNumber: 1 });
tripSchema.index({ reference: 1 });
tripSchema.index({ tripId: 1 });
tripSchema.index({ 'shareConfig.token': 1 });
tripSchema.index({ 'audit.lastStatusChangedAt': -1 });

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

tripSchema.pre('save', function () {
  const now = new Date();

  if (!this.audit?.statusHistory?.length) {
    this.audit.statusHistory = [
      {
        status: this.status,
        changedAt: now,
        changedBy: this.audit?.createdBy || {},
        note: 'Trip created',
      },
    ];
    this.audit.lastStatusChangedAt = now;
  }

  if (!this.isNew && this.isModified('status')) {
    this.audit.lastStatusChangedAt = now;
    this.audit.statusHistory.push({
      status: this.status,
      changedAt: now,
      changedBy: this.audit?.updatedBy || {},
      note: null,
    });
  }

  if (this.status === TRIP_STATUS.PLANNED && !this.queuedAt) {
    this.queuedAt = now;
  }

  if (this.status === TRIP_STATUS.ACTIVE && !this.activatedAt) {
    this.activatedAt = now;
  }

  if (this.status === TRIP_STATUS.POD_PENDING) {
    this.closureStatus = 'POD_PENDING';
    if (!this.podTimerStartedAt) {
      this.podTimerStartedAt = now;
    }
  } else if (this.status === TRIP_STATUS.CLOSED_WITH_POD) {
    this.closureStatus = 'CLOSED_WITH_POD';
  } else if (this.status === TRIP_STATUS.CLOSED_WITHOUT_POD) {
    this.closureStatus = 'CLOSED_WITHOUT_POD';
  } else if (this.status === TRIP_STATUS.CANCELLED) {
    this.closureStatus = 'CANCELLED';
  } else {
    this.closureStatus = 'OPEN';
  }

  if (this.shareConfig?.token) {
    this.shareToken = this.shareConfig.token;
    this.shareTokenExpiry = this.shareConfig.expiresAt;
  }
});

module.exports = mongoose.model('Trip', tripSchema);
