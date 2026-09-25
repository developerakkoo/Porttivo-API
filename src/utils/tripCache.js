const { deleteCachePattern } = require('./cache');
const logger = require('./logger');

const TRIP_LIST_CACHE_TTL = 60;
const TRIP_SEARCH_CACHE_TTL = 30;
const TRIP_ACTIVE_CACHE_TTL = 30;
const TRIP_STATUS_CACHE_TTL = 30;
const TRIP_MARKETPLACE_AWARDED_CACHE_TTL = 45;
const TRIP_PENDING_POD_CACHE_TTL = 60;
const TRIP_DRAFT_LIST_CACHE_TTL = 60;
const TRIP_DRAFT_DETAIL_CACHE_TTL = 120;

const getActorScope = (user, transporterId) =>
  encodeURIComponent(
    JSON.stringify({
      userId: String(user?.id || user?._id || ''),
      userType: user?.userType || '',
      transporterId: transporterId ? String(transporterId) : '',
    })
  );

const sortQueryValue = (value) => {
  if (Array.isArray(value)) return value.map(sortQueryValue);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = sortQueryValue(value[key]);
        return sorted;
      }, {});
  }
  return value;
};

const stableQuery = (query = {}) => JSON.stringify(sortQueryValue(query));

const buildTripDraftListCacheKey = (user, transporterId) =>
  `trip-drafts:list:${getActorScope(user, transporterId)}`;

const buildTripDraftDetailCacheKey = (user, transporterId, draftId) =>
  `trip-drafts:detail:${getActorScope(user, transporterId)}:${encodeURIComponent(String(draftId))}`;

const buildTripListCacheKey = (user, transporterId, query) =>
  `trips:list:${getActorScope(user, transporterId)}:${encodeURIComponent(stableQuery(query))}`;

const buildTripReadCacheKey = (view, user, transporterId, query) =>
  `trips:${view}:${getActorScope(user, transporterId)}:${encodeURIComponent(stableQuery(query))}`;

const invalidateTripCaches = async () => {
  const patterns = [
    deleteCachePattern('trip-drafts:*'),
    deleteCachePattern('trips:*'),
    deleteCachePattern('driver:trips:*'),
    deleteCachePattern('admin:*'),
    deleteCachePattern('admin:dashboard-stats:*'),
    deleteCachePattern('admin:analytics:*'),
    deleteCachePattern('admin:trips:*'),
    deleteCachePattern('admin:drivers:*'),
    deleteCachePattern('admin:driver:*'),
  ];
  const results = await Promise.all(patterns);
  logger.info('CACHE INVALIDATION', {
    patterns: [
      'trip-drafts:*',
      'trips:*',
      'driver:trips:*',
      'admin:*',
      'admin:dashboard-stats:*',
      'admin:analytics:*',
      'admin:trips:*',
      'admin:drivers:*',
      'admin:driver:*',
    ],
    skipped: results.some(result => !result),
  });
};

module.exports = {
  TRIP_LIST_CACHE_TTL,
  TRIP_SEARCH_CACHE_TTL,
  TRIP_ACTIVE_CACHE_TTL,
  TRIP_STATUS_CACHE_TTL,
  TRIP_MARKETPLACE_AWARDED_CACHE_TTL,
  TRIP_PENDING_POD_CACHE_TTL,
  TRIP_DRAFT_LIST_CACHE_TTL,
  TRIP_DRAFT_DETAIL_CACHE_TTL,
  buildTripDraftListCacheKey,
  buildTripDraftDetailCacheKey,
  buildTripListCacheKey,
  buildTripReadCacheKey,
  invalidateTripCaches,
};