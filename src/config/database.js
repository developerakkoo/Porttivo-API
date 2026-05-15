const mongoose = require('mongoose');
const { mongodbUri } = require('./env');
const logger = require('../utils/logger');

let isConnected = false;

const connectDB = async () => {
  if (isConnected) {
    logger.info('MongoDB already connected');
    return;
  }

  try {
    const conn = await mongoose.connect(mongodbUri);

    isConnected = true;
    logger.info(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    logger.error('MongoDB connection error', { message: error.message });
    isConnected = false;
    // Retry connection after 5 seconds
    setTimeout(connectDB, 5000);
  }
};

// Handle connection events
mongoose.connection.on('disconnected', () => {
  logger.info('MongoDB disconnected');
  isConnected = false;
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error', { message: err.message });
  isConnected = false;
});

module.exports = connectDB;
