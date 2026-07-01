require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  /** Engine.IO path; must match Flutter `SOCKET_IO_PATH` / nginx when using a subpath (e.g. `/api/socket.io`). */
  socketIoPath: process.env.SOCKET_IO_PATH || '/socket.io',
  mongodbUri: process.env.MONGODB_URI || 'mongodb+srv://shubhamshelke6103_db:shubhamshelke@cluster0.23riiuz.mongodb.net/porttivo?appName=Cluster0',
  jwtSecret: process.env.JWT_SECRET || 'default-secret-key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  watiApiEndpoint: process.env.WATI_API_ENDPOINT || 'https://live-mt-server.wati.io/10105134',
  watiBearerToken: process.env.WATI_BEARER_TOKEN || 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1bmlxdWVfbmFtZSI6ImZpbmFuY2VAcG9ydHRpdm8uY29tIiwibmFtZWlkIjoiZmluYW5jZUBwb3J0dGl2by5jb20iLCJlbWFpbCI6ImZpbmFuY2VAcG9ydHRpdm8uY29tIiwiYXV0aF90aW1lIjoiMDMvMTMvMjAyNiAwODowNzowOSIsInRlbmFudF9pZCI6IjEwMTA1MTM0IiwiZGJfbmFtZSI6Im10LXByb2QtVGVuYW50cyIsImh0dHA6Ly9zY2hlbWFzLm1pY3Jvc29mdC5jb20vd3MvMjAwOC8wNi9pZGVudGl0eS9jbGFpbXMvcm9sZSI6IkFETUlOSVNUUkFUT1IiLCJleHAiOjI1MzQwMjMwMDgwMCwiaXNzIjoiQ2xhcmVfQUkiLCJhdWQiOiJDbGFyZV9BSSJ9.JUUjmcXwmp2d68IzM1HyFKeDp2VewosdvE4ki_6p0l4',
  watiDefaultCountryCode: process.env.WATI_DEFAULT_COUNTRY_CODE || '91',
  watiBroadcastPrefix: process.env.WATI_BROADCAST_PREFIX || 'porttivo',
  surepassRcFullUrl: process.env.SUREPASS_RC_FULL_URL || 'https://sandbox.surepass.app/api/v1/rc/rc-full',
  surepassApiToken: process.env.SUREPASS_API_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJmcmVzaCI6ZmFsc2UsImlhdCI6MTc4MDkxMzI3NywianRpIjoiMDI0MjI4MTItZDkwNi00ZmNiLWEwNDEtYTFiMWE2YTU5ZTFmIiwidHlwZSI6ImFjY2VzcyIsImlkZW50aXR5IjoiZGV2LmZpbmFuY2VfMTQ4NTYxQHN1cmVwYXNzLmlvIiwibmJmIjoxNzgwOTEzMjc3LCJleHAiOjE3ODM1MDUyNzcsImVtYWlsIjoiZmluYW5jZV8xNDg1NjFAc3VyZXBhc3MuaW8iLCJ0ZW5hbnRfaWQiOiJtYWluIiwidXNlcl9jbGFpbXMiOnsic2NvcGVzIjpbInVzZXIiXX19.h21Zd8pbRV_XRftQ4bL0PsLkN5sH9kdMjlq25DuAg90',
  surepassRequestTimeoutMs: Number(process.env.SUREPASS_REQUEST_TIMEOUT_MS || 10000),
};
