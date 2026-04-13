const Vehicle = require('../models/Vehicle');
const VehicleRouteAvailability = require('../models/VehicleRouteAvailability');

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
    };

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
    if (origin) query.origin = { $regex: new RegExp(`^${origin.trim()}$`, 'i') };
    if (destination) query.destination = { $regex: new RegExp(`^${destination.trim()}$`, 'i') };
    if (vehicleType) query.vehicleType = vehicleType;

    // Date filtering
    const filterDate = date ? new Date(date) : new Date();
    if (!isNaN(filterDate)) {
      // ensure match where availableFrom <= filterDate <= availableTo
      query.availableFrom = { $lte: filterDate };
      query.availableTo = { $gte: filterDate };
    }

    const skip = (Number(page) - 1) * Number(limit);

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
    }));

    const total = await VehicleRouteAvailability.countDocuments(query);

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

    const posts = await VehicleRouteAvailability.find({ transporterId }).sort({ createdAt: -1 }).populate('vehicleId', 'vehicleNumber vehicleType');

    return res.status(200).json({ success: true, message: 'Your availability posts', data: { posts } });
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

    return res.status(200).json({ success: true, message: 'Post cancelled' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createAvailability,
  searchAvailability,
  getMyPosts,
  cancelPost,
};
