# In-app notifications — operations and scale

This documents how notification APIs behave at scale and recommended operational practices for Porttivo.

## API safeguards

- **`GET /api/notifications`**: `limit` is capped at **100** per request. Use `page` for pagination.
- **`types` query** (comma-separated): filters by multiple notification `type` values. Overrides single `type` when both are sent.
- **`unreadCount`** in the list response reflects **unread notifications matching the same type filter** as the list query (when `type` / `types` is used).
- **`GET /api/notifications/unread-summary`**: returns only **`unreadCount`** for the requested types (default: support-related: `SUPPORT_TICKET_CREATED`, `SUPPORT_MESSAGE`, `SUPPORT_STATUS_CHANGED`). Prefer this for badges instead of pulling full lists.
- **`PUT /api/notifications/read-all`**: optional **`types`** (or **`type`**) query limits which unread rows are updated—useful for “mark all support alerts read” without touching other notification kinds.

## Realtime

- After creating admin in-app rows for support events, the API may emit **`admin:notification`** to the **`admin:all`** Socket.IO room so UIs can refresh the tray without relying only on polling.

## Storage and volume (lakhs of tickets)

Each support event that calls **`notifyAllActiveAdmins`** inserts **one `Notification` document per active admin**. At very high ticket volume this collection grows quickly.

Recommended practices:

1. **Retention**: periodically **delete or archive read notifications** older than N days (e.g. 90), or cap **documents per user** (e.g. keep newest 5k–10k per admin).
2. **Indexing**: ensure compound indexes match your queries (`userId`, `userType`, `type`, `read`, `createdAt`).
3. **Product alternatives at extreme scale**:
   - **Digest** multiple ticket-created events into fewer notifications.
   - **Work-queue badge** derived from **`SupportTicket`** (e.g. count where `unreadByAdmin > 0`) instead of storing one notification per ticket for badge purposes.
4. **UI**: never load unbounded lists; the admin bell uses a **small fixed page size** and links to the **Support inbox** as the canonical triage surface.

## Admin app

- The header bell uses **`unread-summary`** plus a **paged list** (e.g. 20 items) scoped to support types only.
- Polling (e.g. ~55s) plus **tab visibility** refresh complements socket updates where available.
