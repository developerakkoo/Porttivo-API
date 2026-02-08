require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  // Use IPv4 loopback to avoid IPv6 (::1) connection issues on some Windows setups
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/porttivo',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
};
