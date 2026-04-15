const Vehicle = require('../models/Vehicle');
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability');
const { getIO } = require('../services/socket.service');

// Create a new vehicle availability post
const createAvailability = async (req, res, next) => {
  try {
    const transporterId = req.user?.id;
    if (!transporterId) {
      return res.status(403).json({ success: false, message: 'Only transporters can post availability' });
    }

    const {
      vehicleId,
      vehicleType,
      origin,
      destination,
      availableFrom,
      availableTo,
      durationDays,
      quantity,
      note,
    } = req.body;

    if (!origin || origin.toString().trim() === '') {
      return res.status(400).json({ success: false, message: 'Origin is required' });
    }

    // vehicleType is required
    const allowedTypes = ['20FT', '40FT', '40FT Open', 'Trailer', 'Closed Body', '22FT'];
    if (!vehicleType || !allowedTypes.includes(vehicleType)) {
      return res.status(400).json({ success: false, message: `vehicleType is required. Allowed: ${allowedTypes.join(', ')}` });
    }

    // Parse dates
    if (!availableFrom) {
      return res.status(400).json({ success: false, message: 'availableFrom date is required' });
    }

    const fromDate = new Date(availableFrom);
    if (isNaN(fromDate)) {
      return res.status(400).json({ success: false, message: 'Invalid availableFrom date' });
    }

    let toDate = null;
    if (availableTo) {
      toDate = new Date(availableTo);
      if (isNaN(toDate)) {
        return res.status(400).json({ success: false, message: 'Invalid availableTo date' });
      }
    } else if (durationDays) {
      const days = parseInt(durationDays, 10);
      if (isNaN(days) || days <= 0) {
        return res.status(400).json({ success: false, message: 'Invalid durationDays' });
      }
      // availableTo is inclusive
      toDate = new Date(fromDate);
      toDate.setDate(toDate.getDate() + days - 1);
    } else {
      return res.status(400).json({ success: false, message: 'Either availableTo or durationDays is required' });
    }

    // If vehicleId provided, validate it belongs to transporter
    if (vehicleId) {
      const vehicle = await Vehicle.findById(vehicleId);
      if (!vehicle) {
        return res.status(400).json({ success: false, message: 'Vehicle not found' });
      }
      if (vehicle.transporterId.toString() !== transporterId) {
        return res.status(403).json({ success: false, message: 'You do not own the specified vehicle' });
      }
      // If vehicle has a vehicleType set, ensure it matches
      if (vehicle.vehicleType && vehicle.vehicleType !== vehicleType) {
        return res.status(400).json({ success: false, message: 'vehicleType does not match the selected vehicle' });
      }
    }

    const post = await VehicleRouteAvailability.create({
      transporterId,
      vehicleId: vehicleId || null,
      vehicleType,
      origin: origin.trim(),
      destination: destination?.trim() || null,
      quantity: quantity ? Number(quantity) : 1,
      availableFrom: fromDate,
      availableTo: toDate,
      note: note || null,
      status: 'active',
    });

    // Populate transporter and vehicle for frontend-friendly response
    const populated = await VehicleRouteAvailability.findById(post._id)
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType driverId')
      .populate('transporterId', 'name company mobile status')
      .lean();

    const response = {
      id: populated._id,
      transporter: populated.transporterId
        ? {
            id: populated.transporterId._id || populated.transporterId,
            name: populated.transporterId.name || null,
            company: populated.transporterId.company || null,
            mobile: populated.transporterId.mobile || null,
            status: populated.transporterId.status || null,
          }
        : null,
      vehicle: populated.vehicleId
        ? {
            id: populated.vehicleId._id,
            vehicleNumber: populated.vehicleId.vehicleNumber || null,
            vehicleType: populated.vehicleId.vehicleType || populated.vehicleType,
            trailerType: populated.vehicleId.trailerType || null,
          }
        : null,
      vehicleType: populated.vehicleType,
      origin: populated.origin,
      destination: populated.destination,
      quantity: populated.quantity,
      availableFrom: populated.availableFrom,
      availableTo: populated.availableTo,
      note: populated.note,
      status: populated.status,
      createdAt: populated.createdAt,
      updatedAt: populated.updatedAt,
      lastEdited: populated.updatedAt,
    };

    // Emit socket event to notify other clients about new availability
    try {
      const io = getIO();
      io.emit('vehiclePost:created', { post: response });
    } catch (err) {
      // Socket not initialized or emit failed — continue without failing the request
      console.warn('Socket emit failed (vehiclePost:created):', err.message || err);
    }

    return res.status(201).json({ success: true, message: 'Vehicle availability posted', data: { post: response } });
  } catch (error) {
    next(error);
  }
};

// Search availability posts (visible to authenticated users)
const searchAvailability = async (req, res, next) => {
  try {
    const { origin, destination, date, vehicleType, page = 1, limit = 20 } = req.query;

    const query = { status: 'active' };

    // escape user input for safe regex construction
    const escapeRegex = (s) => (s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build flexible matching: when searching by origin or destination, allow
    // matches against either field so posts are visible to all transporters.
    // Use string-based $regex + $options so the query serializes cleanly.
    const extraAnd = [];

    if (origin) {
      const pattern = escapeRegex(origin.trim());
      extraAnd.push({ $or: [{ origin: { $regex: pattern, $options: 'i' } }, { destination: { $regex: pattern, $options: 'i' } }] });
    }

    if (vehicleType) extraAnd.push({ vehicleType });

    if (destination) {
      const pattern = escapeRegex(destination.trim());
      extraAnd.push({ $or: [{ destination: { $regex: pattern, $options: 'i' } }, { origin: { $regex: pattern, $options: 'i' } }, { destination: null }, { destination: '' }] });
    }

    // merge extraAnd into main query as $and if needed
    if (extraAnd.length) query.$and = extraAnd;

    // Date filtering - treat the filter as a day and match posts whose
    // availability range intersects that day (inclusive). This avoids
    // excluding posts that end earlier the same day because of time-of-day.
    const rawFilterDate = date ? new Date(date) : new Date();
    if (!isNaN(rawFilterDate)) {
      const startOfDay = new Date(rawFilterDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(rawFilterDate);
      endOfDay.setHours(23, 59, 59, 999);

      // match where availableFrom <= endOfDay AND availableTo >= startOfDay
      query.availableFrom = { $lte: endOfDay };
      query.availableTo = { $gte: startOfDay };

      try {
        console.debug('vehiclePost.searchAvailability - filter range:', { startOfDay: startOfDay.toISOString(), endOfDay: endOfDay.toISOString() });
      } catch (e) {}
    }

    const skip = (Number(page) - 1) * Number(limit);

    // Debug: log query details and requester to help diagnose visibility issues
    try {
      console.debug('vehiclePost.searchAvailability - user:', req.user?.id, 'patterns:', { origin: origin ? escapeRegex(origin.trim()) : null, destination: destination ? escapeRegex(destination.trim()) : null, date: date || null });
      console.debug('vehiclePost.searchAvailability - finalQueryPreview:', JSON.stringify(query));
    } catch (e) {
      // ignore serialization issues
    }

    const posts = await VehicleRouteAvailability.find(query)
      .sort({ availableFrom: 1, createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate('vehicleId', 'vehicleNumber vehicleType transporterId')
      .populate('transporterId', 'name company mobile status')
      .lean();

    // Attach transporter and vehicle summary
    const results = posts.map((p) => ({
      id: p._id,
      transporter: p.transporterId
        ? {
            id: p.transporterId._id || p.transporterId,
            name: p.transporterId.name || null,
            company: p.transporterId.company || null,
            mobile: p.transporterId.mobile || null,
            status: p.transporterId.status || null,
          }
        : { id: p.transporterId },
      vehicleId: p.vehicleId ? p.vehicleId._id : null,
      vehicleNumber: p.vehicleId ? p.vehicleId.vehicleNumber : null,
      vehicleType: p.vehicleType,
      origin: p.origin,
      destination: p.destination,
      quantity: p.quantity,
      availableFrom: p.availableFrom,
      availableTo: p.availableTo,
      note: p.note,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      lastEdited: p.updatedAt,
    }));

    const total = await VehicleRouteAvailability.countDocuments(query);
    try {
      console.debug('vehiclePost.searchAvailability - results:', posts.length, 'total:', total);
    } catch (e) {}

    return res.status(200).json({ success: true, message: 'Availability posts retrieved', data: { results, total } });
  } catch (error) {
    next(error);
  }
};

// Get posts for authenticated transporter
const getMyPosts = async (req, res, next) => {
  try {
    const transporterId = req.user?.id;
    if (!transporterId) return res.status(403).json({ success: false, message: 'Only transporters can access their posts' });

    const posts = await VehicleRouteAvailability.find({ transporterId })
      .sort({ createdAt: -1 })
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .populate('transporterId', 'name company mobile status')
      .lean();

    const results = posts.map((p) => ({
      id: p._id,
      transporter: p.transporterId
        ? {
            id: p.transporterId._id || p.transporterId,
            name: p.transporterId.name || null,
            company: p.transporterId.company || null,
            mobile: p.transporterId.mobile || null,
            status: p.transporterId.status || null,
          }
        : null,
      vehicle: p.vehicleId
        ? {
            id: p.vehicleId._id,
            vehicleNumber: p.vehicleId.vehicleNumber || null,
            vehicleType: p.vehicleId.vehicleType || p.vehicleType,
            trailerType: p.vehicleId.trailerType || null,
          }
        : null,
      vehicleType: p.vehicleType,
      origin: p.origin,
      destination: p.destination,
      quantity: p.quantity,
      availableFrom: p.availableFrom,
      availableTo: p.availableTo,
      note: p.note,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      lastEdited: p.updatedAt,
    }));

    return res.status(200).json({ success: true, message: 'Your availability posts', data: { results } });
  } catch (error) {
    next(error);
  }
};

// Get single post by id (active for anyone; non-active only for owner)
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const post = await VehicleRouteAvailability.findById(id)
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .populate('transporterId', 'name company mobile status')
      .lean();

    if (!post) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const ownerId = post.transporterId?._id?.toString() || post.transporterId?.toString();
    const isOwner = ownerId === userId;

    if (post.status !== 'active' && !isOwner) {
      return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const p = post;
    const response = {
      id: p._id,
      transporter: p.transporterId
        ? {
            id: p.transporterId._id || p.transporterId,
            name: p.transporterId.name || null,
            company: p.transporterId.company || null,
            mobile: p.transporterId.mobile || null,
            status: p.transporterId.status || null,
          }
        : null,
      vehicle: p.vehicleId
        ? {
            id: p.vehicleId._id,
            vehicleNumber: p.vehicleId.vehicleNumber || null,
            vehicleType: p.vehicleId.vehicleType || p.vehicleType,
            trailerType: p.vehicleId.trailerType || null,
          }
        : null,
      vehicleType: p.vehicleType,
      origin: p.origin,
      destination: p.destination,
      quantity: p.quantity,
      availableFrom: p.availableFrom,
      availableTo: p.availableTo,
      note: p.note,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      lastEdited: p.updatedAt,
    };

    return res.status(200).json({ success: true, data: { post: response } });
  } catch (error) {
    next(error);
  }
};

// Update a post (owner only)
const updateAvailability = async (req, res, next) => {
  try {
    const transporterId = req.user?.id;
    if (!transporterId) return res.status(403).json({ success: false, message: 'Only transporters can update posts' });

    const { id } = req.params;
    const { vehicleId, vehicleType, origin, destination, availableFrom, availableTo, durationDays, quantity, note, status } = req.body;

    const post = await VehicleRouteAvailability.findById(id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    if (post.transporterId.toString() !== transporterId) return res.status(403).json({ success: false, message: 'Not authorized' });

    // Update fields if provided
    if (vehicleType !== undefined) {
      const allowedTypes = ['20FT', '40FT', '40FT Open', 'Trailer', 'Closed Body', '22FT'];
      if (!allowedTypes.includes(vehicleType)) return res.status(400).json({ success: false, message: `Invalid vehicleType. Allowed: ${allowedTypes.join(', ')}` });
      post.vehicleType = vehicleType;
    }
    if (vehicleId !== undefined) post.vehicleId = vehicleId || null;
    if (origin !== undefined) post.origin = origin?.trim() || post.origin;
    if (destination !== undefined) post.destination = destination?.trim() || null;
    if (quantity !== undefined) post.quantity = Number(quantity) || post.quantity;
    if (note !== undefined) post.note = note || null;
    if (status !== undefined) post.status = status;

    // Dates
    if (availableFrom) {
      const fromDate = new Date(availableFrom);
      if (isNaN(fromDate)) return res.status(400).json({ success: false, message: 'Invalid availableFrom date' });
      post.availableFrom = fromDate;
    }
    if (availableTo) {
      const toDate = new Date(availableTo);
      if (isNaN(toDate)) return res.status(400).json({ success: false, message: 'Invalid availableTo date' });
      post.availableTo = toDate;
    } else if (durationDays) {
      const days = parseInt(durationDays, 10);
      if (isNaN(days) || days <= 0) return res.status(400).json({ success: false, message: 'Invalid durationDays' });
      const fromDate = post.availableFrom || new Date();
      const toDate = new Date(fromDate);
      toDate.setDate(toDate.getDate() + days - 1);
      post.availableTo = toDate;
    }

    await post.save();

    const populated = await VehicleRouteAvailability.findById(post._id)
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .populate('transporterId', 'name company mobile status')
      .lean();

    const response = {
      id: populated._id,
      transporter: populated.transporterId
        ? {
            id: populated.transporterId._id || populated.transporterId,
            name: populated.transporterId.name || null,
            company: populated.transporterId.company || null,
            mobile: populated.transporterId.mobile || null,
            status: populated.transporterId.status || null,
          }
        : null,
      vehicle: populated.vehicleId
        ? {
            id: populated.vehicleId._id,
            vehicleNumber: populated.vehicleId.vehicleNumber || null,
            vehicleType: populated.vehicleId.vehicleType || populated.vehicleType,
            trailerType: populated.vehicleId.trailerType || null,
          }
        : null,
      vehicleType: populated.vehicleType,
      origin: populated.origin,
      destination: populated.destination,
      quantity: populated.quantity,
      availableFrom: populated.availableFrom,
      availableTo: populated.availableTo,
      note: populated.note,
      status: populated.status,
      createdAt: populated.createdAt,
      updatedAt: populated.updatedAt,
      lastEdited: populated.updatedAt,
    };

    try {
      const io = getIO();
      io.emit('vehiclePost:updated', { post: response });
    } catch (err) {
      console.warn('Socket emit failed (vehiclePost:updated):', err.message || err);
    }

    return res.status(200).json({ success: true, message: 'Post updated', data: { post: response } });
  } catch (error) {
    next(error);
  }
};

// Cancel a post (owner only)
const cancelPost = async (req, res, next) => {
  try {
    const transporterId = req.user?.id;
    const { id } = req.params;

    const post = await VehicleRouteAvailability.findById(id);
    if (!post) return res.status(404).json({ success: false, message: 'Post not found' });
    if (post.transporterId.toString() !== transporterId) return res.status(403).json({ success: false, message: 'Not authorized' });

    post.status = 'cancelled';
    await post.save();

    // Populate for response & emit socket event
    const populated = await VehicleRouteAvailability.findById(post._id)
      .populate('vehicleId', 'vehicleNumber vehicleType trailerType')
      .populate('transporterId', 'name company mobile status')
      .lean();

    const response = {
      id: populated._id,
      transporter: populated.transporterId
        ? {
            id: populated.transporterId._id || populated.transporterId,
            name: populated.transporterId.name || null,
            company: populated.transporterId.company || null,
            mobile: populated.transporterId.mobile || null,
            status: populated.transporterId.status || null,
          }
        : null,
      vehicle: populated.vehicleId
        ? {
            id: populated.vehicleId._id,
            vehicleNumber: populated.vehicleId.vehicleNumber || null,
            vehicleType: populated.vehicleId.vehicleType || populated.vehicleType,
            trailerType: populated.vehicleId.trailerType || null,
          }
        : null,
      vehicleType: populated.vehicleType,
      origin: populated.origin,
      destination: populated.destination,
      quantity: populated.quantity,
      availableFrom: populated.availableFrom,
      availableTo: populated.availableTo,
      note: populated.note,
      status: populated.status,
      createdAt: populated.createdAt,
      updatedAt: populated.updatedAt,
      lastEdited: populated.updatedAt,
    };

    try {
      const io = getIO();
      io.emit('vehiclePost:updated', { post: response });
    } catch (err) {
      console.warn('Socket emit failed (vehiclePost:updated):', err.message || err);
    }

    return res.status(200).json({ success: true, message: 'Post cancelled', data: { post: response } });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAvailability,
  searchAvailability,
  getMyPosts,
  getById,
  cancelPost,
  updateAvailability,
};
