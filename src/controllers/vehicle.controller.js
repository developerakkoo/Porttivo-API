const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const { checkVehicleHasTripHistory } = require('../utils/vehicleValidation');
const { getTransporterId, hasPermission } = require('../middleware/permission.middleware');

/**
 * Get all vehicles for authenticated transporter
 * GET /api/vehicles
 */
const getVehicles = async (req, res, next) => {
  try {
    // Admins can see all vehicles, transporters and company users can see their own
    const transporterId = getTransporterId(req.user);
    const isAdmin = req.user.userType === 'admin';

    if (!transporterId && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters, authorized company users, or admins can view vehicles.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageVehicles')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to view vehicles.',
      });
    }

    const { status, ownerType, driverId, transporterId: queryTransporterId } = req.query;

    // Build query - admins can see all, others see only their transporter's vehicles
    const query = {};
    if (isAdmin) {
      // Admin can filter by transporterId if provided
      if (queryTransporterId) {
        query.transporterId = queryTransporterId;
      }
      // Otherwise, no filter - show all vehicles
    } else {
      query.transporterId = transporterId;
    }

    if (status) query.status = status;
    if (ownerType) {
      if (!['OWN', 'HIRED'].includes(ownerType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid owner type. Must be OWN or HIRED',
        });
      }

      query.ownerType = ownerType;
    }
    if (driverId) query.driverId = driverId;

    // Get vehicles with populated driver info
    const vehicles = await Vehicle.find(query)
      .populate('driverId', 'name mobile status')
      .populate('originalOwnerId', 'name company')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'Vehicles retrieved successfully',
      data: {
        vehicles: vehicles.map((vehicle) => ({
          id: vehicle._id.toString(),
          vehicleNumber: vehicle.vehicleNumber,
          transporterId: vehicle.transporterId?.toString() || vehicle.transporterId,
          ownerType: vehicle.ownerType,
          originalOwnerId: vehicle.originalOwnerId
            ? typeof vehicle.originalOwnerId === 'object' && vehicle.originalOwnerId._id
              ? vehicle.originalOwnerId._id.toString()
              : vehicle.originalOwnerId.toString()
            : null,
          driverId: vehicle.driverId
            ? typeof vehicle.driverId === 'object' && vehicle.driverId._id
              ? vehicle.driverId._id.toString()
              : vehicle.driverId.toString()
            : null,
          driver: vehicle.driverId
            ? {
                id: vehicle.driverId._id.toString(),
                name: vehicle.driverId.name,
                mobile: vehicle.driverId.mobile,
                status: vehicle.driverId.status,
              }
            : null,
          status: vehicle.status,
          trailerType: vehicle.trailerType,
          documents: vehicle.documents,
          createdAt: vehicle.createdAt,
          updatedAt: vehicle.updatedAt,
        })),
        count: vehicles.length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new vehicle
 * POST /api/vehicles
 */
const createVehicle = async (req, res, next) => {
  try {
    // Transporters and company users with manageVehicles permission can create vehicles
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can create vehicles.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageVehicles')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to create vehicles.',
      });
    }

    const { vehicleNumber, ownerType, driverId, trailerType } = req.body;

    // Validation
    if (!vehicleNumber) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle number is required',
      });
    }

    const cleanedVehicleNumber = vehicleNumber.trim().toUpperCase();
    const finalOwnerType = ownerType || 'OWN';
    if (!['OWN', 'HIRED'].includes(finalOwnerType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid owner type. Must be OWN or HIRED',
      });
    }

    if (finalOwnerType === 'HIRED') {
      return res.status(400).json({
        success: false,
        message: 'Hired vehicles are one-time only. Do not create them in fleet; assign them directly on the trip.',
      });
    }

    // Check if vehicle already exists as OWN (only one OWN allowed per vehicle number)
    if (finalOwnerType === 'OWN') {
      const existingOwnVehicle = await Vehicle.findOne({
        vehicleNumber: cleanedVehicleNumber,
        ownerType: 'OWN',
      });

      if (existingOwnVehicle) {
        return res.status(400).json({
          success: false,
          message: 'Vehicle with this number already exists as OWN. You can add it as HIRED instead.',
        });
      }
    }

    // Validate driver belongs to transporter (if provided)
    if (driverId) {
      const Driver = require('../models/Driver');
      const driver = await Driver.findOne({
        _id: driverId,
        transporterId: transporterId,
      });

      if (!driver) {
        return res.status(400).json({
          success: false,
          message: 'Driver not found or does not belong to your transporter account',
        });
      }
    }

    // Create vehicle
    const vehicle = await Vehicle.create({
      vehicleNumber: cleanedVehicleNumber,
      transporterId: transporterId,
      ownerType: finalOwnerType,
      originalOwnerId: req.user.id,
      driverId: driverId || null,
      trailerType: trailerType?.trim() || null,
      status: 'active',
    });

    // Populate driver info
    await vehicle.populate('driverId', 'name mobile status');

    return res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      data: {
        vehicle: {
          id: vehicle._id.toString(),
          vehicleNumber: vehicle.vehicleNumber,
          transporterId: vehicle.transporterId?.toString() || vehicle.transporterId,
          ownerType: vehicle.ownerType,
          originalOwnerId: vehicle.originalOwnerId
            ? typeof vehicle.originalOwnerId === 'object' && vehicle.originalOwnerId._id
              ? vehicle.originalOwnerId._id.toString()
              : vehicle.originalOwnerId.toString()
            : null,
          driverId: vehicle.driverId
            ? typeof vehicle.driverId === 'object' && vehicle.driverId._id
              ? vehicle.driverId._id.toString()
              : vehicle.driverId.toString()
            : null,
          driver: vehicle.driverId
            ? {
                id: vehicle.driverId._id.toString(),
                name: vehicle.driverId.name,
                mobile: vehicle.driverId.mobile,
                status: vehicle.driverId.status,
              }
            : null,
          status: vehicle.status,
          trailerType: vehicle.trailerType,
          documents: vehicle.documents,
          createdAt: vehicle.createdAt,
          updatedAt: vehicle.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get vehicle by ID
 * GET /api/vehicles/:id
 */
const getVehicleById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findById(id).populate('driverId', 'name mobile status');

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Admins can see all vehicles, transporters can see their own
    if (req.user.userType !== 'admin') {
      if (req.user.userType === 'transporter') {
        if (vehicle.transporterId.toString() !== req.user.id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. You do not have access to this vehicle.',
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Vehicle retrieved successfully',
      data: {
        vehicle: {
          id: vehicle._id.toString(),
          vehicleNumber: vehicle.vehicleNumber,
          transporterId: vehicle.transporterId?.toString() || vehicle.transporterId,
          ownerType: vehicle.ownerType,
          originalOwnerId: vehicle.originalOwnerId
            ? typeof vehicle.originalOwnerId === 'object' && vehicle.originalOwnerId._id
              ? vehicle.originalOwnerId._id.toString()
              : vehicle.originalOwnerId.toString()
            : null,
          driverId: vehicle.driverId
            ? typeof vehicle.driverId === 'object' && vehicle.driverId._id
              ? vehicle.driverId._id.toString()
              : vehicle.driverId.toString()
            : null,
          driver: vehicle.driverId
            ? {
                id: vehicle.driverId._id.toString(),
                name: vehicle.driverId.name,
                mobile: vehicle.driverId.mobile,
                status: vehicle.driverId.status,
              }
            : null,
          status: vehicle.status,
          trailerType: vehicle.trailerType,
          documents: vehicle.documents,
          createdAt: vehicle.createdAt,
          updatedAt: vehicle.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update vehicle
 * PUT /api/vehicles/:id
 */
const updateVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, driverId, trailerType, ownerType } = req.body;

    // Transporters and company users with manageVehicles permission can update vehicles
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can update vehicles.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageVehicles')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to update vehicles.',
      });
    }

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Check ownership - Only actual owner can update
    if (vehicle.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the vehicle owner can update this vehicle.',
      });
    }

    // Build update object
    const updateData = {};
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status. Must be active or inactive',
        });
      }
      updateData.status = status;
    }

    if (driverId !== undefined) {
      if (driverId === null || driverId === '') {
        updateData.driverId = null;
      } else {
        // Validate driver belongs to transporter
        const Driver = require('../models/Driver');
        const driver = await Driver.findOne({
          _id: driverId,
          transporterId: transporterId,
        });

        if (!driver) {
          return res.status(400).json({
            success: false,
            message: 'Driver not found or does not belong to your transporter account',
          });
        }
        updateData.driverId = driverId;
      }
    }

    if (trailerType !== undefined) {
      updateData.trailerType = trailerType?.trim() || null;
    }

    if (ownerType !== undefined) {
      if (!['OWN', 'HIRED'].includes(ownerType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid owner type. Must be OWN or HIRED',
        });
      }

      if (ownerType === 'HIRED') {
        return res.status(400).json({
          success: false,
          message: 'Fleet vehicles cannot be changed to HIRED. Hired vehicles are trip-scoped only.',
        });
      }

      // Cannot change from OWN to HIRED or vice versa
      // Ownership type is set at creation and should not be changed
      if (vehicle.ownerType !== ownerType) {
        return res.status(400).json({
          success: false,
          message: 'Cannot change ownership type. Please delete and recreate the vehicle with the correct ownership type.',
        });
      }
    }

    // Update vehicle
    const updatedVehicle = await Vehicle.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).populate('driverId', 'name mobile status');

    return res.status(200).json({
      success: true,
      message: 'Vehicle updated successfully',
      data: {
        vehicle: {
          id: updatedVehicle._id,
          vehicleNumber: updatedVehicle.vehicleNumber,
          transporterId: updatedVehicle.transporterId,
          ownerType: updatedVehicle.ownerType,
          driverId: updatedVehicle.driverId,
          driver: updatedVehicle.driverId
            ? {
                id: updatedVehicle.driverId._id,
                name: updatedVehicle.driverId.name,
                mobile: updatedVehicle.driverId.mobile,
                status: updatedVehicle.driverId.status,
              }
            : null,
          status: updatedVehicle.status,
          trailerType: updatedVehicle.trailerType,
          documents: updatedVehicle.documents,
          createdAt: updatedVehicle.createdAt,
          updatedAt: updatedVehicle.updatedAt,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete vehicle
 * DELETE /api/vehicles/:id
 */
const deleteVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Transporters and company users with manageVehicles permission can delete vehicles
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can delete vehicles.',
      });
    }

    // Check permission for company users
    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageVehicles')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to delete vehicles.',
      });
    }

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Check ownership - Only actual owner can delete
    if (vehicle.transporterId.toString() !== transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the vehicle owner can delete this vehicle.',
      });
    }

    // Check if vehicle has trip history
    const hasTripHistory = await checkVehicleHasTripHistory(id);

    if (hasTripHistory) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete vehicle with trip history. Such vehicles can only be marked as inactive. Please update the status to inactive instead.',
      });
    }

    // Delete vehicle
    await Vehicle.findByIdAndDelete(id);

    return res.status(200).json({
      success: true,
      message: 'Vehicle deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get vehicle trip history
 * GET /api/vehicles/:id/trips
 */
const getVehicleTrips = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Check access (for transporters and company users)
    if (transporterId) {
      // Check permission for company users
      if (req.user.userType === 'company-user' && !hasPermission(req.user, 'viewTrips')) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have permission to view trips.',
        });
      }

      if (vehicle.transporterId.toString() !== transporterId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have access to this vehicle.',
        });
      }
    }

    // Get trips for this vehicle - filter by transporterId to ensure trip visibility isolation
    // Only show trips created by the authenticated transporter/company user's transporter
    const trips = await Trip.find({
      vehicleId: id,
      transporterId: transporterId || undefined,
    })
      .populate('driverId', 'name mobile')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      message: 'Vehicle trips retrieved successfully',
      data: {
        trips,
        count: trips.length,
      },
    });
  } catch (error) {
    next(error);
  }
};


module.exports = {
  getVehicles,
  createVehicle,
  getVehicleById,
  updateVehicle,
  deleteVehicle,
  getVehicleTrips,
};
