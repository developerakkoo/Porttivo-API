const TripLocationLog = require('../models/TripLocationLog');

const TRACKING_UPDATE_INTERVAL_SECONDS = 5;

const toJsonSafe = (value) => {
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(
    JSON.stringify(value, (key, currentValue) => {
      if (currentValue instanceof Date) return currentValue.toISOString();
      if (typeof currentValue === 'bigint') return currentValue.toString();
      return currentValue;
    })
  );
};

const buildSocketClientIp = (socket) => {
  const xf = socket?.handshake?.headers?.['x-forwarded-for'];
  return (
    (typeof xf === 'string' && xf.split(',')[0]?.trim()) ||
    socket?.handshake?.address ||
    null
  );
};

const logTripLocationUpdate = ({
  trip,
  driverId,
  latitude,
  longitude,
  socket = null,
  accuracy = null,
  speed = null,
  heading = null,
  source = 'socket',
  payload = {},
}) => {
  const row = {
    tripId: trip?._id,
    tripReference: trip?.tripId || null,
    driverId,
    transporterId: trip?.transporterId || null,
    vehicleId: trip?.vehicleId || null,
    vehicleNumber: trip?.vehicleId?.vehicleNumber || trip?.hiredVehicle?.vehicleNumber || null,
    eventType: 'LOCATION_UPDATE',
    latitude,
    longitude,
    accuracy: accuracy ?? null,
    speed: speed ?? null,
    heading: heading ?? null,
    socketId: socket?.id || null,
    clientIp: buildSocketClientIp(socket),
    userAgent: socket?.handshake?.headers?.['user-agent']
      ? String(socket.handshake.headers['user-agent']).slice(0, 250)
      : null,
    source,
    payload: toJsonSafe(payload) || {},
  };

  console.log('[Trip/location]', JSON.stringify({
    eventType: row.eventType,
    tripId: row.tripReference || String(row.tripId || ''),
    driverId: String(row.driverId || ''),
    latitude: row.latitude,
    longitude: row.longitude,
    timestamp: new Date().toISOString(),
    socketId: row.socketId,
    clientIp: row.clientIp,
  }));

  setImmediate(() => {
    TripLocationLog.create(row).catch((error) => {
      console.error('Trip location log failed:', error.message);
    });
  });
};

module.exports = {
  TRACKING_UPDATE_INTERVAL_SECONDS,
  logTripLocationUpdate,
};
