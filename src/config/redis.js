const { createClient } = require('redis');
const { redisUrl } = require('./env');

const redisClient = createClient({
  url: redisUrl,
});

redisClient.on('error', (error) => {
  console.error('Redis Client Error:', error.message);
});

redisClient.on('connect', () => {
  console.log('Redis connecting...');
});

redisClient.on('ready', () => {
  console.log('Redis connected and ready');
});

redisClient.on('reconnecting', () => {
  console.log('Redis reconnecting...');
});

redisClient.on('end', () => {
  console.log('Redis connection closed');
});

const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
};

module.exports = {
  redisClient,
  connectRedis,
};