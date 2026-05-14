/**
 * Centralized error handling middleware
 */
const errorHandler = (err, req, res, next) => {
  console.error(
    '[API/error]',
    JSON.stringify({
      method: req.method,
      path: req.originalUrl || req.url || req.path || '',
      statusCode: err.statusCode || 500,
      userType: req.user?.userType || null,
      userId: req.user?.id || null,
      message: err.message || 'Internal server error',
      name: err.name || null
    })
  );

  // Default error
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let error = err;

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation error';
    error = Object.values(err.errors).map((e) => e.message).join(', ');
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    statusCode = 400;
    message = 'Duplicate entry';
    const field = Object.keys(err.keyPattern)[0];
    error = `${field} already exists`;
  }

  // Mongoose cast error (invalid ObjectId)
  if (err.name === 'CastError') {
    statusCode = 400;
    message = 'Invalid ID format';
    error = 'The provided ID is not valid';
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  res.status(statusCode).json({
    success: false,
    message: message,
    error: process.env.NODE_ENV === 'development' ? error : undefined,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

/**
 * 404 Not Found handler
 */
const notFound = (req, res) => {
  console.warn(
    '[API/404]',
    JSON.stringify({
      method: req.method,
      path: req.originalUrl,
      userType: req.user?.userType || null,
      userId: req.user?.id || null
    })
  );
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
};

module.exports = {
  errorHandler,
  notFound,
};
