# Socket.IO trip events (client reference)

All authenticated clients join a role room on connect (`transporter:{id}`, `driver:{id}`, `customer:{id}`, `admin:all` for admins).

## Server → client

| Event | Payload | Notes |
|-------|---------|--------|
| `trip:updated` | `{ trip, reason, changedFields }` | `reason` e.g. `driver_accepted`, `trip_updated`; `changedFields` lists request keys that changed. |
| `trip:driver:assigned` | `{ trip, assignment }` | |
| `trip:started` | `{ trip, currentMilestone?, trackingConfig? }` | `trackingConfig.updateIntervalSeconds` tells the client how often to send location updates. |
| `trip:milestone:updated` | `{ trip, milestone, currentMilestone? }` | |
| `driver:location:updated` | `{ tripId, trip, latitude, longitude, accuracy?, speed?, heading?, timestamp }` | Only when trip is ACTIVE; `trip` includes `lastDriverLocation`. |
| `trip:pod:approved` | `{ trip, message, approvedAt?, closedReason? }` | Visible to the driver after transporter approves POD. |
| `trip:cancelled` | `{ trip }` | |

## Client → server (driver)

| Event | Payload |
|-------|---------|
| `driver:location:update` | `{ tripId, latitude, longitude }` |
| `trip:start` | `{ tripId }` |
| `trip:milestone:update` | See API docs |

Room joins: `join:transporter`, `join:driver`, `join:vehicle`, `join:trip`, `join:customer`.
