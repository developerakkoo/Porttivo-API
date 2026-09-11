const { redisClient } = require('../config/redis');

/**
 * Get JSON data from Redis.
 * Returns null when key does not exist or Redis is unavailable.
 */
const getCache = async (key) => {
  try {
    if (!redisClient.isReady) {
      return null;
    }

    const cachedData = await redisClient.get(key);

    if (!cachedData) {
      return null;
    }

    return JSON.parse(cachedData);
  } catch (error) {
    console.error(`Redis GET failed for key ${key}:`, error.message);
    return null;
  }
};

/**
 * Store JSON data in Redis with TTL in seconds.
 */
const setCache = async (key, data, ttlSeconds) => {
  try {
    if (!redisClient.isReady) {
      return false;
    }

    await redisClient.set(
      key,
      JSON.stringify(data),
      {
        EX: ttlSeconds,
      }
    );

    return true;
  } catch (error) {
    console.error(`Redis SET failed for key ${key}:`, error.message);
    return false;
  }
};

/**
 * Delete a cache key.
 */
const deleteCache = async (key) => {
  try {
    if (!redisClient.isReady) {
      return false;
    }

    await redisClient.del(key);

    return true;
  } catch (error) {
    console.error(`Redis DELETE failed for key ${key}:`, error.message);
    return false;
  }
};

/**
 * Delete cache keys matching a pattern.
 */
const deleteCachePattern = async (pattern) => {
  try {
    if (!redisClient.isReady) {
      return false;
    }

    const keys = await redisClient.keys(pattern);
    if (keys && keys.length > 0) {
      await redisClient.del(keys);
    }

    return true;
  } catch (error) {
    console.error(`Redis DELETE pattern failed for pattern ${pattern}:`, error.message);
    return false;
  }
};

module.exports = {
  getCache,
  setCache,
  deleteCache,
  deleteCachePattern,
};