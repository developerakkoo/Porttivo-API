const XLSX = require('xlsx');
const Vehicle = require('../models/Vehicle');
const Trip = require('../models/Trip');
const Driver = require('../models/Driver');
const {
  checkVehicleHasTripHistory,
  getVehicleAvailabilityState,
  validateIndianVehicleRegistrationFormat,
} = require('../utils/vehicleValidation');
const { getTransporterId, hasPermission } = require('../middleware/permission.middleware');
const { assertVehicleTypeAllowed } = require('../services/vehicleTypeCatalog.service');
const { verifyRcFull } = require('../services/surepass.service');

const formatVehicleResponse = (vehicle) => {
  if (!vehicle) return null;

  const transporter = vehicle.transporterId && typeof vehicle.transporterId === 'object'
    ? vehicle.transporterId
    : null;
  const originalOwner = vehicle.originalOwnerId && typeof vehicle.originalOwnerId === 'object'
    ? vehicle.originalOwnerId
    : null;
  const driver = vehicle.driverId && typeof vehicle.driverId === 'object'
    ? vehicle.driverId
    : null;

  const hasSurepassVerification = vehicle.rcVerification?.source === 'surepass' && vehicle.rcVerification?.statusCode === 200;

  return {
    id: vehicle._id.toString(),
    vehicleNumber: vehicle.vehicleNumber,
    transporter: transporter
      ? {
          id: transporter._id.toString(),
          mobile: transporter.mobile,
          name: transporter.name,
          email: transporter.email,
          company: transporter.company,
          status: transporter.status,
          hasAccess: transporter.hasAccess,
        }
      : null,
    transporterId: vehicle.transporterId?._id?.toString?.() || vehicle.transporterId?.toString?.() || vehicle.transporterId || null,
    ownerType: vehicle.ownerType,
    originalOwner: originalOwner
      ? {
          id: originalOwner._id.toString(),
          mobile: originalOwner.mobile,
          name: originalOwner.name,
          email: originalOwner.email,
          company: originalOwner.company,
          status: originalOwner.status,
          hasAccess: originalOwner.hasAccess,
        }
      : null,
    originalOwnerId: vehicle.originalOwnerId?._id?.toString?.() || vehicle.originalOwnerId?.toString?.() || vehicle.originalOwnerId || null,
    driver: driver
      ? {
          id: driver._id.toString(),
          name: driver.name,
          mobile: driver.mobile,
          status: driver.status,
        }
      : null,
    driverId: vehicle.driverId?._id?.toString?.() || vehicle.driverId?.toString?.() || vehicle.driverId || null,
    status: vehicle.status,
    isBusy: vehicle.isBusy,
    vehicleType: vehicle.vehicleType || null,
    trailerType: vehicle.trailerType || null,
    documents: vehicle.documents || {},
    rcVerification: vehicle.rcVerification
      ? {
          verified: !!vehicle.rcVerification.verified,
          verifiedBadge: hasSurepassVerification,
          status: vehicle.rcVerification.status || 'pending',
          source: vehicle.rcVerification.source || 'surepass',
          checkedAt: vehicle.rcVerification.checkedAt || null,
          statusCode: vehicle.rcVerification.statusCode ?? null,
          message: vehicle.rcVerification.message || null,
          messageCode: vehicle.rcVerification.messageCode || null,
          verifiedVehicleNumber: vehicle.rcVerification.verifiedVehicleNumber || null,
          rawResponse: vehicle.rcVerification.rawResponse || null,
        }
      : null,
    verifiedBadge: hasSurepassVerification,
    createdAt: vehicle.createdAt,
    updatedAt: vehicle.updatedAt,
  };
};

const validateDriverVehicleLink = async ({ driverId, transporterId, excludeVehicleId = null }) => {
  const driver = await Driver.findOne({
    _id: driverId,
    transporterId,
  });

  if (!driver) {
    return {
      error: 'Driver not found or does not belong to your transporter account',
      statusCode: 400,
    };
  }

  if (driver.status !== 'active') {
    return {
      error: 'Only active drivers can be assigned to vehicles',
      statusCode: 400,
    };
  }

  const existingVehicle = await Vehicle.findOne({
    driverId,
    transporterId,
    ...(excludeVehicleId ? { _id: { $ne: excludeVehicleId } } : {}),
  }).select('_id vehicleNumber');

  if (existingVehicle) {
    return {
      error: `Driver is already assigned to vehicle ${existingVehicle.vehicleNumber}. Please clear the existing assignment first.`,
      statusCode: 400,
    };
  }

  return { driver };
};

const buildRcVerificationSnapshot = (verification, vehicleNumber) => ({
  verified: !!verification?.verified,
  status: verification?.status || 'pending',
  source: verification?.source || 'surepass',
  checkedAt: verification?.verifiedAt || null,
  statusCode: verification?.statusCode ?? null,
  message: verification?.message || null,
  messageCode: verification?.messageCode || null,
  verifiedVehicleNumber: vehicleNumber,
  rawResponse: verification?.rawResponse || null,
});

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

    const { status, ownerType, driverId, transporterId: queryTransporterId, availableForTrip } = req.query;

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
    let vehicles = await Vehicle.find(query)
      .populate('transporterId', 'mobile name email company status hasAccess')
      .populate('originalOwnerId', 'mobile name email company status hasAccess')
      .populate('driverId', 'name mobile status')
      .sort({ createdAt: -1 });

    if (availableForTrip === 'true') {
      const candidateVehicles = await Promise.all(
        vehicles.map(async (vehicle) => {
          const availability = await getVehicleAvailabilityState(vehicle._id.toString());
          return {
            vehicle,
            availability,
          };
        })
      );

      vehicles = candidateVehicles
        .filter(({ vehicle, availability }) => vehicle.status === 'active' && availability.isAvailable)
        .map(({ vehicle }) => vehicle);
    }

    return res.status(200).json({
      success: true,
      message: 'Vehicles retrieved successfully',
      data: {
        vehicles: vehicles.map(formatVehicleResponse),
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

    const { vehicleNumber, ownerType, driverId, trailerType, vehicleType } = req.body;

    // Validation
    if (!vehicleNumber) {
      return res.status(400).json({
        success: false,
        message: 'Vehicle number is required',
      });
    }

    const formatResult = validateIndianVehicleRegistrationFormat(vehicleNumber);
    if (formatResult.error) {
      return res.status(400).json({
        success: false,
        message: formatResult.error,
      });
    }
    const cleanedVehicleNumber = formatResult.normalized;
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
      const driverValidation = await validateDriverVehicleLink({
        driverId,
        transporterId,
      });

      if (driverValidation.error) {
        return res.status(driverValidation.statusCode).json({
          success: false,
          message: driverValidation.error,
        });
      }
    }

    // Validate vehicleType if provided (DB catalog)
    let finalVehicleType = null;
    if (vehicleType !== undefined && vehicleType !== null && vehicleType !== '') {
      const typeCheck = await assertVehicleTypeAllowed(vehicleType, {
        transporterId,
        allowOwnPending: true,
      });
      if (!typeCheck.ok) {
        return res.status(400).json({
          success: false,
          message: typeCheck.message,
        });
      }
      finalVehicleType = typeCheck.name;
    }

    const rcVerification = await verifyRcFull(cleanedVehicleNumber);

    // Create vehicle
    const vehicle = await Vehicle.create({
      vehicleNumber: cleanedVehicleNumber,
      transporterId: transporterId,
      ownerType: finalOwnerType,
      originalOwnerId: req.user.id,
      driverId: driverId || null,
      trailerType: trailerType?.trim() || null,
      vehicleType: finalVehicleType,
      status: 'active',
      rcVerification: buildRcVerificationSnapshot(rcVerification, cleanedVehicleNumber),
    });

    // Populate driver info
    await vehicle.populate([
      { path: 'transporterId', select: 'mobile name email company status hasAccess' },
      { path: 'originalOwnerId', select: 'mobile name email company status hasAccess' },
      { path: 'driverId', select: 'name mobile status' },
    ]);

    return res.status(201).json({
      success: true,
      message: 'Vehicle created successfully',
      data: {
        vehicle: formatVehicleResponse(vehicle),
        verification: {
          verified: !!vehicle.rcVerification?.verified,
          verifiedBadge: vehicle.rcVerification?.source === 'surepass' && vehicle.rcVerification?.statusCode === 200,
          status: vehicle.rcVerification?.status || 'pending',
          source: vehicle.rcVerification?.source || 'surepass',
          checkedAt: vehicle.rcVerification?.checkedAt || null,
          message: vehicle.rcVerification?.message || null,
          messageCode: vehicle.rcVerification?.messageCode || null,
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

    const vehicle = await Vehicle.findById(id)
      .populate('transporterId', 'mobile name email company status hasAccess')
      .populate('originalOwnerId', 'mobile name email company status hasAccess')
      .populate('driverId', 'name mobile status');

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
        vehicle: formatVehicleResponse(vehicle),
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
    const { status, driverId, trailerType, ownerType, vehicleType } = req.body;

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
        const driverValidation = await validateDriverVehicleLink({
          driverId,
          transporterId,
          excludeVehicleId: id,
        });

        if (driverValidation.error) {
          return res.status(driverValidation.statusCode).json({
            success: false,
            message: driverValidation.error,
          });
        }
        updateData.driverId = driverId;
      }
    }

    if (trailerType !== undefined) {
      updateData.trailerType = trailerType?.trim() || null;
    }

    if (vehicleType !== undefined) {
      if (vehicleType === null || vehicleType === '') {
        updateData.vehicleType = null;
      } else {
        const typeCheck = await assertVehicleTypeAllowed(vehicleType, {
        transporterId,
        allowOwnPending: true,
      });
        if (!typeCheck.ok) {
          return res.status(400).json({
            success: false,
            message: typeCheck.message,
          });
        }
        updateData.vehicleType = typeCheck.name;
      }
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


/**
 * Read a value from a parsed spreadsheet row using a list of candidate header
 * names (case-insensitive, ignores spaces/underscores).
 */
const pickCell = (row, candidates) => {
  const normalizedKeys = {};
  for (const key of Object.keys(row)) {
    normalizedKeys[key.toLowerCase().replace(/[\s_]+/g, '')] = key;
  }
  for (const candidate of candidates) {
    const norm = candidate.toLowerCase().replace(/[\s_]+/g, '');
    if (normalizedKeys[norm] !== undefined) {
      const value = row[normalizedKeys[norm]];
      return value === null || value === undefined ? '' : String(value).trim();
    }
  }
  return '';
};

const deferredRcSnapshot = (vehicleNumber) => ({
  verified: false,
  status: 'pending',
  source: 'surepass',
  checkedAt: null,
  statusCode: null,
  message: 'RC verification deferred for bulk import',
  messageCode: null,
  verifiedVehicleNumber: vehicleNumber,
  rawResponse: null,
});

/**
 * Bulk import fleet from an uploaded spreadsheet (.xlsx/.xls/.csv).
 * Expected columns: vehicleNumber, vehicleType, driverName, driverMobile.
 * All rows are treated as OWN vehicles. RC verification is deferred.
 * POST /api/vehicles/bulk-import
 */
const bulkImportVehicles = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only transporters and authorized company users can import fleet.',
      });
    }

    if (req.user.userType === 'company-user' && !hasPermission(req.user, 'manageVehicles')) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You do not have permission to import fleet.',
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please attach an .xlsx or .csv file in the "file" field.',
      });
    }

    let rows;
    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        return res.status(400).json({
          success: false,
          message: 'The uploaded file has no sheets.',
        });
      }
      rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        message: 'Could not read the file. Please upload a valid .xlsx, .xls or .csv file.',
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'The file has no data rows.',
      });
    }

    const results = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < rows.length; i++) {
      // +2 => account for header row and 1-based spreadsheet numbering
      const rowNumber = i + 2;
      const row = rows[i];

      const rawVehicleNumber = pickCell(row, ['vehicleNumber', 'vehicle number', 'vehicle no', 'vehicleno']);
      const rawVehicleType = pickCell(row, ['vehicleType', 'vehicle type', 'type']);
      const rawDriverName = pickCell(row, ['driverName', 'driver name', 'driver']);
      const rawDriverMobile = pickCell(row, ['driverMobile', 'driver mobile', 'mobile', 'phone', 'driver phone']);

      // Skip completely empty rows silently
      if (!rawVehicleNumber && !rawVehicleType && !rawDriverName && !rawDriverMobile) {
        continue;
      }

      try {
        if (!rawVehicleNumber) {
          throw new Error('Vehicle number is required');
        }

        const formatResult = validateIndianVehicleRegistrationFormat(rawVehicleNumber);
        if (formatResult.error) {
          throw new Error(formatResult.error);
        }
        const cleanedVehicleNumber = formatResult.normalized;

        const existingOwnVehicle = await Vehicle.findOne({
          vehicleNumber: cleanedVehicleNumber,
          ownerType: 'OWN',
        });
        if (existingOwnVehicle) {
          throw new Error('Vehicle with this number already exists as OWN');
        }

        // Validate vehicle type (if provided)
        let finalVehicleType = null;
        if (rawVehicleType) {
          const typeCheck = await assertVehicleTypeAllowed(rawVehicleType, {
            transporterId,
            allowOwnPending: true,
          });
          if (!typeCheck.ok) {
            throw new Error(typeCheck.message);
          }
          finalVehicleType = typeCheck.name;
        }

        // Resolve / create driver (optional)
        let driverId = null;
        if (rawDriverMobile) {
          const digits = rawDriverMobile.replace(/[^0-9]/g, '');
          const cleanedMobile = digits.length > 10 ? digits.slice(-10) : digits;
          if (cleanedMobile.length !== 10) {
            throw new Error('Driver mobile must be 10 digits');
          }

          let driver = await Driver.findOne({ mobile: cleanedMobile });
          if (driver) {
            if (driver.transporterId && driver.transporterId.toString() !== transporterId.toString()) {
              throw new Error('Driver mobile is linked to another transporter');
            }
            // Adopt an unlinked existing driver
            if (!driver.transporterId) {
              driver.transporterId = transporterId;
              if (driver.status !== 'active') driver.status = 'active';
              await driver.save();
            }
          } else {
            driver = await Driver.create({
              mobile: cleanedMobile,
              name: rawDriverName || '',
              transporterId,
              status: 'active',
            });
          }

          // Ensure the driver is assignable (active and not already on another vehicle)
          const linkCheck = await validateDriverVehicleLink({
            driverId: driver._id.toString(),
            transporterId,
          });
          if (linkCheck.error) {
            throw new Error(linkCheck.error);
          }
          driverId = driver._id.toString();
        }

        const vehicle = await Vehicle.create({
          vehicleNumber: cleanedVehicleNumber,
          transporterId,
          ownerType: 'OWN',
          originalOwnerId: req.user.id,
          driverId,
          vehicleType: finalVehicleType,
          status: 'active',
          rcVerification: deferredRcSnapshot(cleanedVehicleNumber),
        });

        succeeded += 1;
        results.push({
          row: rowNumber,
          success: true,
          vehicleNumber: cleanedVehicleNumber,
          vehicleId: vehicle._id.toString(),
          driverId,
        });
      } catch (rowError) {
        failed += 1;
        results.push({
          row: rowNumber,
          success: false,
          vehicleNumber: rawVehicleNumber || null,
          error: rowError.message || 'Failed to import row',
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Bulk import completed',
      data: {
        summary: {
          total: succeeded + failed,
          succeeded,
          failed,
        },
        results,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getVehicles,
  createVehicle,
  bulkImportVehicles,
  getVehicleById,
  updateVehicle,
  deleteVehicle,
  getVehicleTrips,
};
