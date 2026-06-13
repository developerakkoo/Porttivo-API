const { getTransporterId } = require('../middleware/permission.middleware');
const {
  serializeCustomer,
  createCustomer,
  listCustomers,
} = require('../services/transporterCustomer.service');

const listTransporterCustomers = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Transporter context is required.',
      });
    }

    const q = req.query.q?.toString?.()?.trim?.() || '';
    const results = await listCustomers(transporterId, q);

    return res.status(200).json({
      success: true,
      data: { results },
    });
  } catch (error) {
    next(error);
  }
};

const createTransporterCustomer = async (req, res, next) => {
  try {
    const transporterId = getTransporterId(req.user);
    if (!transporterId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Transporter context is required.',
      });
    }

    const { name } = req.body;
    const result = await createCustomer(transporterId, name);
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    return res.status(result.status).json({
      success: true,
      message: result.message,
      data: {
        customer: serializeCustomer(result.customer),
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Customer already exists',
      });
    }
    next(error);
  }
};

module.exports = {
  listTransporterCustomers,
  createTransporterCustomer,
};
