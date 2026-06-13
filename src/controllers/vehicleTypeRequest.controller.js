const { getTransporterId } = require('../middleware/permission.middleware');
const { emitVehicleTypeRequestUpdated } = require('../services/socket.service');
const {
  serializeRequest,
  submitVehicleTypeRequest,
  listMyRequests,
  listAdminRequests,
  approveVehicleTypeRequest,
  rejectVehicleTypeRequest,
} = require('../services/vehicleTypeRequest.service');

const canManageVehicleTypes = (req) => {
  if (req.user?.userType === 'admin') return true;
  if (req.user?.userType === 'transporter') return true;
  if (req.user?.userType === 'company-user') {
    const perms = req.user.permissions || [];
    return perms.includes('manageVehicles') || perms.includes('all');
  }
  return false;
};

const submitRequest = async (req, res, next) => {
  try {
    if (!canManageVehicleTypes(req)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Transporter context required to submit vehicle type requests',
      });
    }

    const { name } = req.body;
    const result = await submitVehicleTypeRequest({
      name,
      transporterId,
      userId: req.user.id,
      userType: req.user.userType,
    });

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    return res.status(result.status).json({
      success: true,
      message: result.message,
      data: {
        request: serializeRequest(result.request),
        status: result.request.status,
      },
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This vehicle type is already pending approval',
      });
    }
    next(err);
  }
};

const listMine = async (req, res, next) => {
  try {
    if (!canManageVehicleTypes(req)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Transporter context required',
      });
    }

    const results = await listMyRequests(transporterId);
    return res.status(200).json({ success: true, data: { results } });
  } catch (err) {
    next(err);
  }
};

const listRequestsAdmin = async (req, res, next) => {
  try {
    const status = req.query.status?.toString()?.trim() || 'pending';
    const results = await listAdminRequests(status);
    return res.status(200).json({ success: true, data: { results } });
  } catch (err) {
    next(err);
  }
};

const approveRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await approveVehicleTypeRequest(id, req.user.id);

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    if (result.didTransition) {
      const serialized = serializeRequest(result.request);
      emitVehicleTypeRequestUpdated(
        result.request.submittedByTransporterId?.toString?.(),
        serialized
      );
    }

    return res.status(result.status).json({
      success: true,
      message: result.message,
      data: {
        request: serializeRequest(result.request),
        vehicleType: result.vehicleType,
      },
    });
  } catch (err) {
    next(err);
  }
};

const rejectRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const result = await rejectVehicleTypeRequest(id, req.user.id, reason);

    if (!result.ok) {
      return res.status(result.status).json({ success: false, message: result.message });
    }

    if (result.didTransition) {
      const serialized = serializeRequest(result.request);
      emitVehicleTypeRequestUpdated(
        result.request.submittedByTransporterId?.toString?.(),
        serialized
      );
    }

    return res.status(result.status).json({
      success: true,
      message: result.message,
      data: { request: serializeRequest(result.request) },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  submitRequest,
  listMine,
  listRequestsAdmin,
  approveRequest,
  rejectRequest,
};
