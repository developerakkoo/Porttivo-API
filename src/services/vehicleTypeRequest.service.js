const VehicleType = require('../models/VehicleType');
const VehicleTypeRequest = require('../models/VehicleTypeRequest');
const Transporter = require('../models/Transporter');
const {
  normalizeVehicleTypeName,
  normalizedNameKey,
  serializeType,
} = require('./vehicleTypeCatalog.service');

const serializeRequest = (doc, submitter = null) => ({
  id: doc._id?.toString?.() || doc.id,
  requestedName: doc.requestedName,
  status: doc.status,
  submittedByTransporterId: doc.submittedByTransporterId?.toString?.() || doc.submittedByTransporterId,
  submittedByUserId: doc.submittedByUserId?.toString?.() || doc.submittedByUserId,
  submittedByUserType: doc.submittedByUserType,
  reviewedAt: doc.reviewedAt || null,
  rejectionReason: doc.rejectionReason || null,
  approvedVehicleTypeId: doc.approvedVehicleTypeId?.toString?.() || doc.approvedVehicleTypeId || null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
  submitter: submitter
    ? {
        id: submitter._id?.toString?.() || submitter.id,
        name: submitter.name || null,
        mobile: submitter.mobile || null,
        company: submitter.company || null,
      }
    : undefined,
});

const validateRequestName = (name) => {
  const trimmed = normalizeVehicleTypeName(name);
  if (!trimmed) {
    return { ok: false, message: 'Vehicle type name is required' };
  }
  if (trimmed.length < 2) {
    return { ok: false, message: 'Vehicle type name must be at least 2 characters' };
  }
  if (trimmed.length > 100) {
    return { ok: false, message: 'Vehicle type name must be 100 characters or less' };
  }
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, message: 'Vehicle type name contains invalid characters' };
  }
  return { ok: true, name: trimmed, normalizedName: normalizedNameKey(trimmed) };
};

const submitVehicleTypeRequest = async ({ name, transporterId, userId, userType }) => {
  const validation = validateRequestName(name);
  if (!validation.ok) {
    return { ok: false, status: 400, message: validation.message };
  }

  const activeMatch = await VehicleType.findOne({
    name: validation.name,
    isActive: { $ne: false },
  });
  if (activeMatch) {
    return {
      ok: false,
      status: 409,
      message: 'This vehicle type already exists in the catalog',
    };
  }

  const inactiveMatch = await VehicleType.findOne({
    name: validation.name,
    isActive: false,
  });
  if (inactiveMatch) {
    return {
      ok: false,
      status: 409,
      message: 'This vehicle type exists but is inactive. Please contact admin.',
    };
  }

  const existingPending = await VehicleTypeRequest.findOne({
    status: 'pending',
    normalizedName: validation.normalizedName,
  });
  if (existingPending) {
    if (existingPending.submittedByTransporterId.toString() === transporterId.toString()) {
      return {
        ok: true,
        status: 200,
        request: existingPending,
        message: 'Request already pending approval',
      };
    }
    return {
      ok: false,
      status: 409,
      message: 'This vehicle type is already pending approval',
    };
  }

  const request = await VehicleTypeRequest.create({
    requestedName: validation.name,
    normalizedName: validation.normalizedName,
    status: 'pending',
    submittedByTransporterId: transporterId,
    submittedByUserId: userId,
    submittedByUserType: userType,
  });

  return { ok: true, status: 201, request, message: 'Vehicle type submitted for approval' };
};

const listMyRequests = async (transporterId) => {
  const requests = await VehicleTypeRequest.find({
    submittedByTransporterId: transporterId,
  })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return requests.map((doc) => serializeRequest(doc));
};

const listAdminRequests = async (status = 'pending') => {
  const query = {};
  if (status) {
    query.status = status;
  }

  const requests = await VehicleTypeRequest.find(query)
    .sort({ createdAt: -1 })
    .lean();

  const transporterIds = [...new Set(requests.map((r) => r.submittedByTransporterId.toString()))];
  const transporters = await Transporter.find({ _id: { $in: transporterIds } })
    .select('name mobile company')
    .lean();
  const transporterMap = new Map(transporters.map((t) => [t._id.toString(), t]));

  return requests.map((doc) =>
    serializeRequest(doc, transporterMap.get(doc.submittedByTransporterId.toString()))
  );
};

const approveVehicleTypeRequest = async (requestId, adminId) => {
  const request = await VehicleTypeRequest.findById(requestId);
  if (!request) {
    return { ok: false, status: 404, message: 'Vehicle type request not found' };
  }

  if (request.status === 'approved') {
    const existingType = request.approvedVehicleTypeId
      ? await VehicleType.findById(request.approvedVehicleTypeId)
      : await VehicleType.findOne({ name: request.requestedName });
    return {
      ok: true,
      status: 200,
      request,
      vehicleType: existingType ? serializeType(existingType) : null,
      message: 'Request already approved',
    };
  }

  if (request.status === 'rejected') {
    return { ok: false, status: 409, message: 'Cannot approve a rejected request' };
  }

  let vehicleType = await VehicleType.findOne({ name: request.requestedName });
  if (vehicleType) {
    if (vehicleType.isActive === false) {
      vehicleType.isActive = true;
      await vehicleType.save();
    }
  } else {
    const maxSort = await VehicleType.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
    vehicleType = await VehicleType.create({
      name: request.requestedName,
      code: request.normalizedName.replace(/\s+/g, '_').slice(0, 50),
      isActive: true,
      sortOrder: (maxSort?.sortOrder ?? 0) + 1,
    });
  }

  request.status = 'approved';
  request.reviewedByAdminId = adminId;
  request.reviewedAt = new Date();
  request.approvedVehicleTypeId = vehicleType._id;
  request.rejectionReason = null;
  await request.save();

  return {
    ok: true,
    status: 200,
    request,
    vehicleType: serializeType(vehicleType),
    message: 'Vehicle type approved',
  };
};

const rejectVehicleTypeRequest = async (requestId, adminId, reason) => {
  const request = await VehicleTypeRequest.findById(requestId);
  if (!request) {
    return { ok: false, status: 404, message: 'Vehicle type request not found' };
  }

  if (request.status === 'approved') {
    return { ok: false, status: 409, message: 'Cannot reject an approved request' };
  }

  if (request.status === 'rejected') {
    return {
      ok: true,
      status: 200,
      request,
      message: 'Request already rejected',
    };
  }

  request.status = 'rejected';
  request.reviewedByAdminId = adminId;
  request.reviewedAt = new Date();
  request.rejectionReason = reason?.toString?.()?.trim?.() || null;
  await request.save();

  return {
    ok: true,
    status: 200,
    request,
    message: 'Vehicle type request rejected',
  };
};

const countPendingRequests = async () => VehicleTypeRequest.countDocuments({ status: 'pending' });

module.exports = {
  serializeRequest,
  validateRequestName,
  submitVehicleTypeRequest,
  listMyRequests,
  listAdminRequests,
  approveVehicleTypeRequest,
  rejectVehicleTypeRequest,
  countPendingRequests,
};
