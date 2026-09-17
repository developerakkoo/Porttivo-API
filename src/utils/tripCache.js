const { deleteCachePattern } = require('./cache');

const TRIP_LIST_CACHE_TTL = 60;
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

const invalidateTripCaches = async () => {
  await Promise.all([
    deleteCachePattern('trip-drafts:*'),
    deleteCachePattern('trips:*'),
  ]);
  console.log('CACHE INVALIDATION: trip and draft caches');
};

module.exports = {
  TRIP_LIST_CACHE_TTL,
  TRIP_DRAFT_LIST_CACHE_TTL,
  TRIP_DRAFT_DETAIL_CACHE_TTL,
  buildTripDraftListCacheKey,
  buildTripDraftDetailCacheKey,
  buildTripListCacheKey,
  invalidateTripCaches,
};