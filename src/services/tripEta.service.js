/**
 * Server-side trip ETA / route-progress / movement-stage.
 *
 * Computed centrally so every viewer (transporter, customer, shared link) sees
 * identical values, and clients don't each call Google. Geometric progress is
 * instant (haversine); road ETA is fetched from Google Distance Matrix on a
 * throttled, cached, best-effort basis so it never blocks the socket hot path.
 */

const GOOGLE_MAPS_API_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_DIRECTIONS_KEY ||
  'AIzaSyA6EcL6hrD0iQpwk6ETUQNSieeEBYUR1_U';

// Assume ~30 km/h urban average when no live road ETA is available yet.
const DEFAULT_SPEED_MPS = 8.33;
const NEAR_RADIUS_METERS = 150;

// Per-trip ETA cache: tripId -> { etaSeconds, distanceMeters, fetchedAt, fetching }
const etaCache = new Map();
const ETA_FRESH_MS = 45 * 1000;
const ETA_REFRESH_MS = 30 * 1000;
const ETA_FETCH_TIMEOUT_MS = 3000;

const toRad = (deg) => (deg * Math.PI) / 180;

const haversineMeters = (aLat, aLng, bLat, bLng) => {
  const R = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Extract { lat, lng } from a Trip location subdocument ([lng, lat] GeoJSON). */
const extractLatLng = (location) => {
  if (!location) return null;
  const coords = location.coordinates;
  if (Array.isArray(coords) && coords.length === 2) {
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  if (
    coords &&
    Number.isFinite(Number(coords.latitude)) &&
    Number.isFinite(Number(coords.longitude))
  ) {
    return { lat: Number(coords.latitude), lng: Number(coords.longitude) };
  }
  return null;
};

/**
 * Coarse movement stage from milestone progress + geofence proximity.
 * Labels intentionally match the transporter client fallback.
 */
const resolveMovementStage = (trip, lat, lng) => {
  const pickup = extractLatLng(trip.pickupLocation);
  const drop = extractLatLng(trip.dropLocation);
  const milestoneCount = Array.isArray(trip.milestones) ? trip.milestones.length : 0;

  const nearDrop =
    drop && haversineMeters(lat, lng, drop.lat, drop.lng) <= NEAR_RADIUS_METERS;
  const nearPickup =
    pickup && haversineMeters(lat, lng, pickup.lat, pickup.lng) <= NEAR_RADIUS_METERS;

  if (nearDrop) return 'Near destination';
  if (milestoneCount >= 4) return 'Near destination';
  if (milestoneCount === 3) return 'Loading / unloading';
  if (milestoneCount === 2) return 'En route to destination';
  if (milestoneCount === 1) return 'Container picked up';
  if (nearPickup) return 'At pickup';
  return 'En route to pickup';
};

/** Geometric (straight-line) remaining distance + progress to the drop point. */
const computeGeoProgress = (trip, lat, lng) => {
  const pickup = extractLatLng(trip.pickupLocation);
  const drop = extractLatLng(trip.dropLocation);
  if (!drop) return { distanceRemainingMeters: null, routeProgressPercent: null };

  const remaining = haversineMeters(lat, lng, drop.lat, drop.lng);
  let progress = null;
  if (pickup) {
    const total = haversineMeters(pickup.lat, pickup.lng, drop.lat, drop.lng);
    if (total > 0) {
      progress = Math.max(0, Math.min(100, ((total - remaining) / total) * 100));
    }
  }
  return { distanceRemainingMeters: Math.round(remaining), routeProgressPercent: progress };
};

const fetchRoadEta = async (originLat, originLng, destLat, destLng) => {
  if (typeof fetch !== 'function') return null;
  const url =
    'https://maps.googleapis.com/maps/api/distancematrix/json' +
    `?origins=${originLat},${originLng}` +
    `&destinations=${destLat},${destLng}` +
    '&mode=driving&departure_time=now' +
    `&key=${GOOGLE_MAPS_API_KEY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ETA_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    const element = json?.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') return null;
    const etaSeconds =
      element.duration_in_traffic?.value ?? element.duration?.value ?? null;
    const distanceMeters = element.distance?.value ?? null;
    if (etaSeconds == null) return null;
    return { etaSeconds, distanceMeters };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Cached, throttled road ETA. Returns a fresh cached value immediately, or null
 * while a background refresh is in flight (callers fall back to geometric ETA).
 */
const getRoadEta = (trip, lat, lng) => {
  const drop = extractLatLng(trip.dropLocation);
  if (!drop) return null;
  const id = trip._id?.toString?.() || String(trip._id);
  const now = Date.now();
  const entry = etaCache.get(id);

  if (entry && now - entry.fetchedAt < ETA_FRESH_MS) {
    if (!entry.fetching && now - entry.fetchedAt >= ETA_REFRESH_MS) {
      triggerEtaRefresh(id, lat, lng, drop, entry);
    }
    return entry;
  }

  if (!entry || !entry.fetching) {
    triggerEtaRefresh(id, lat, lng, drop, entry);
  }
  return entry && now - entry.fetchedAt < ETA_FRESH_MS ? entry : null;
};

const triggerEtaRefresh = (id, lat, lng, drop, existing) => {
  const base = existing || { etaSeconds: null, distanceMeters: null, fetchedAt: 0 };
  base.fetching = true;
  etaCache.set(id, base);
  fetchRoadEta(lat, lng, drop.lat, drop.lng)
    .then((result) => {
      if (result) {
        etaCache.set(id, {
          etaSeconds: result.etaSeconds,
          distanceMeters: result.distanceMeters,
          fetchedAt: Date.now(),
          fetching: false,
        });
      } else {
        base.fetching = false;
        etaCache.set(id, base);
      }
    })
    .catch(() => {
      base.fetching = false;
      etaCache.set(id, base);
    });
};

/** Clear cached ETA for a trip (e.g. on completion/cancel). */
const clearTripEta = (tripId) => {
  if (!tripId) return;
  etaCache.delete(tripId.toString?.() || String(tripId));
};

/**
 * Build the full set of tracking metrics to attach to `driver:location:updated`.
 * Never throws and never blocks on network.
 */
const buildTrackingMetrics = (trip, lat, lng, speed = null) => {
  try {
    const geo = computeGeoProgress(trip, lat, lng);
    const movementStage = resolveMovementStage(trip, lat, lng);

    const cached = getRoadEta(trip, lat, lng);
    let etaSeconds = cached?.etaSeconds ?? null;
    let distanceRemainingMeters =
      cached?.distanceMeters ?? geo.distanceRemainingMeters;

    // Geometric ETA fallback until a road ETA is cached.
    if (etaSeconds == null && geo.distanceRemainingMeters != null) {
      const speedMps = speed != null && Number(speed) > 1.5 ? Number(speed) : DEFAULT_SPEED_MPS;
      etaSeconds = Math.round(geo.distanceRemainingMeters / speedMps);
    }

    return {
      etaSeconds,
      distanceRemainingMeters,
      routeProgressPercent:
        geo.routeProgressPercent == null
          ? null
          : Math.round(geo.routeProgressPercent),
      movementStage,
    };
  } catch (error) {
    console.error('buildTrackingMetrics failed:', error.message);
    return {
      etaSeconds: null,
      distanceRemainingMeters: null,
      routeProgressPercent: null,
      movementStage: null,
    };
  }
};

module.exports = {
  buildTrackingMetrics,
  clearTripEta,
  extractLatLng,
  haversineMeters,
};
