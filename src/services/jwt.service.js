const jwt = require('jsonwebtoken');
const { jwtSecret, jwtExpiresIn, jwtRefreshExpiresIn } = require('../config/env');

/**
 * Generate access token
 * @param {Object} payload - Token payload (userId, mobile, userType)
 * @returns {String} JWT access token
 */
const generateAccessToken = (payload) => {
  return jwt.sign(payload, jwtSecret, {
    expiresIn: jwtExpiresIn,
  });
};

/**
 * Generate refresh token
 * @param {Object} payload - Token payload (userId, mobile, userType)
 * @returns {String} JWT refresh token
 */
const generateRefreshToken = (payload) => {
  return jwt.sign(payload, jwtSecret, {
    expiresIn: jwtRefreshExpiresIn,
  });
};

/**
 * Generate both access and refresh tokens
 * @param {Object} user - User object with id, mobile, userType
 * @returns {Object} Object containing accessToken and refreshToken
 */
const generateTokens = (user) => {
  const payload = {
    userId: user.id || user._id.toString(),
    mobile: user.mobile,
    userType: user.userType,
  };

  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};

/**
 * Verify JWT token
 * @param {String} token - JWT token to verify
 * @returns {Object} Decoded token payload
 */
const verifyToken = (token) => {
  try {
    return jwt.verify(token, jwtSecret);
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token has expired');
    } else if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else {
      throw new Error('Token verification failed');
    }
  }
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  generateTokens,
  verifyToken,
};
