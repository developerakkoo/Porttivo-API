const Vehicle = require('../models/Vehicle');
const { getVehicleAvailabilityState } = require('../utils/vehicleValidation');

/**
 * Get vehicle availability state
 * GET /api/vehicles/:id/availability
 */
const getAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;

    const vehicle = await Vehicle.findById(id);

    if (!vehicle) {
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Check access (for transporters)
    if (req.user.userType === 'transporter') {
      const hasAccess =
        vehicle.transporterId.toString() === req.user.id ||
        (vehicle.hiredBy && vehicle.hiredBy.some((transporterId) => transporterId.toString() === req.user.id));

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You do not have access to this vehicle.',
        });
      }
    }

    const availability = await getVehicleAvailabilityState(id);

    return res.status(200).json({
      success: true,
      message: 'Vehicle availability retrieved successfully',
      data: {
        vehicleId: id,
        vehicleNumber: vehicle.vehicleNumber,
        availability,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAvailability,
};
