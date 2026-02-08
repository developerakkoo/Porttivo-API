require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  // Use IPv4 loopback to avoid IPv6 (::1) connection issues on some Windows setups
  mongodbUri: process.env.MONGODB_URI || 'mongodb+srv://ShubhamShelke:Shubhamshelke@cluster0.23riiuz.mongodb.net/porttivo?appName=Cluster0',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
};
