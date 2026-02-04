# Requirements Compliance Checklist

This document maps each functional and non-functional requirement to the implementation in the codebase.

---

## Functional Requirements

### 1. Public Frontend

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Simple web interface to submit issues | ✅ | `frontend/src/pages/ReportIssue.jsx` — form with concern, notes, userName, contact, and location |
| Uses browser Geolocation API | ✅ | `ReportIssue.jsx` — `getLocation()` using `navigator.geolocation.getCurrentPosition()` with options (timeout 10s, high accuracy) |
| Handles permission denied | ✅ | `ReportIssue.jsx` — `err.code === 1` → user message: "Location permission denied. Please allow location access..." |
| Handles location unavailable | ✅ | `ReportIssue.jsx` — `err.code === 2` → "Location unavailable..."; `err.code === 3` → timeout message |
| Displays success and error states | ✅ | `showMsg(text, type)` with classes `success`, `error`, `info`; used for success (ticket ID), validation/API errors, and geolocation errors |
| No authentication required | ✅ | Public form; no auth headers or login for submission |
| Any frontend framework or plain HTML acceptable | ✅ | Plain HTML + minimal JS (Axios for HTTP) |

---

### 2. Service A: Intake and Validation

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Receives form submissions | ✅ | `service-a/index.js` — `POST /api/v1/tickets` |
| Validates inputs | ✅ | Zod schema: concern (1–100), notes (max 2000), userName (1–200), contact (max 100), lat (-90–90), lng (-180–180); 422 + `VALIDATION_ERROR` on failure |
| Calls third-party API for reverse geocoding | ✅ | Nominatim `reverseGeocodeWithRetry()` — `https://nominatim.openstreetmap.org/reverse` |
| Calls third-party API for city boundary validation | ✅ | `isWithinCity(address)` checks city/town/village/state_district/county/state against `CITY_NAME` (e.g. Bangalore/Bengaluru) |
| Outside city → 40x response | ✅ | Returns `403` with `code: "OUTSIDE_CITY"` and error message |
| Inside city → publish event to pub/sub | ✅ | On success: `redis.xadd(STREAM, "*", "data", JSON.stringify(ticket))` then 200 + `ticketId` |
| Stateless | ✅ | No session store; each request independent |
| Handle third-party API failures | ✅ | try/catch in `reverseGeocodeWithRetry`; after retries return 503 `GEOCODE_FAILED` |
| Timeouts and retries | ✅ | `GEOCODE_TIMEOUT_MS = 5000`, `GEOCODE_MAX_RETRIES = 3`, exponential backoff (500*attempt ms; 2s on 429) |
| Log failures | ✅ | `log("warn", ...)` on each geocode attempt failure; `log("error", "Geocoding failed after retries", ...)`; `log("error", "Failed to publish ticket", ...)` |

---

### 3. Third-Party API

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Any geocoding provider acceptable | ✅ | **Nominatim (OpenStreetMap)** is used |
| Explain why you chose it | ✅ | README & DOCUMENTATION: free, no API key, suitable for reverse geocoding and locality names; rate limits documented |
| Handle rate limits and failures | ✅ | User-Agent set per usage policy; 429 detected and longer backoff (2s); retries (3) with backoff; 503 on persistent failure |

---

### 4. Pub/Sub Communication

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Service A publishes events | ✅ | `service-a/index.js` — `redis.xadd(STREAM, "*", "data", JSON.stringify(ticket))` |
| Service B consumes events | ✅ | `service-b/index.js` — `consume()` loop with `redis.xread("BLOCK", 5000, "STREAMS", STREAM, lastId)` |
| Any pub/sub mechanism acceptable | ✅ | **Redis Streams** used (see `docker-compose.yml` — Redis service; REDIS_URL in A and B) |
| Asynchronous and decoupled | ✅ | Service A returns 200 after publish; Service B consumes in background loop; no direct HTTP call A→B |
| Explain delivery guarantees | ✅ | DOCUMENTATION & README: at-least-once; consumer tracks last processed ID |
| Explain failure handling | ✅ | DOCUMENTATION & README: consumer retries on error (1s delay); `INSERT OR IGNORE` for idempotency on replay |

---

### 5. Service B: Ticket Storage

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Consumes pub/sub message queue | ✅ | `service-b/index.js` — `consume()` reads from `tickets-stream`, processes each message |
| Stores tickets in SQLite or Redis | ✅ | SQLite via `better-sqlite3`; DB path from `DB_PATH` (default `tickets.db`); volume `./data:/app/data` in compose |
| Storing data to disk NOT required | ✅ | Requirement allows in-memory; current design uses SQLite on disk for durability — acceptable |
| Ticket data: Ticket ID, Concern, Notes, User name, Lat/long, Area name, Timestamp | ✅ | Table and payload: `id`, `concern`, `notes`, `userName`, `lat`, `lng`, `area`, `timestamp`; optional `contact` also stored |
| Bonus: Duplicate messages | ✅ | `INSERT OR IGNORE` — duplicate IDs (e.g. replay) do not create duplicate rows |
| Bonus: Message replay | ✅ | Same; lastId advances so replay is safe and idempotent |

---

### 6. Government Employee Access

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Internal UI or API sufficient | ✅ | Internal UI: `frontend/src/pages/InternalDashboard.jsx` (route `/internal`); API: Service B `GET /internal/tickets`, etc. |
| Minimum two roles (e.g. Officer & Supervisor) | ✅ | `OFFICER` and `SUPERVISOR` in `service-b/index.js` (ROLES); role select in `InternalDashboard.jsx` |
| RBAC enforced server-side | ✅ | `auth` middleware verifies JWT and role; list/single ticket handlers return limited vs full fields by `req.user.role`; no client trust |
| Authentication approach up to you | ✅ | JWT via `POST /internal/login` (role + optional employeeId); token in `Authorization: Bearer <token>` |
| Field Officer sees limited ticket details | ✅ | Officer: `id`, `concern`, `area`, `timestamp` only (list and by-id) |
| Supervisor sees full ticket details | ✅ | Supervisor: full row (id, concern, notes, userName, contact, lat, lng, area, timestamp) |

---

## Non-Functional Requirements

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| Input validation | ✅ | Service A: Zod schema with lengths and ranges; 422 + `details` for first validation error |
| Secure handling of secrets | ✅ | `JWT_SECRET` and `REDIS_URL` from environment variables; README/DOCUMENTATION note to set JWT_SECRET in production and avoid hardcoding |
| API contracts | ✅ | README and DOCUMENTATION describe request/response shapes, status codes, and error codes for public and internal APIs |
| Meaningful error responses | ✅ | 422 + `VALIDATION_ERROR` + details; 403 + `OUTSIDE_CITY`; 503 + `GEOCODE_FAILED` / `PUBLISH_FAILED`; 401/403 with clear messages for auth; 404 for ticket not found |

---

## Summary

- **All listed functional and non-functional requirements are implemented** in the codebase.
- Third-party API choice (Nominatim), delivery guarantees, and failure handling are explained in README and DOCUMENTATION.
- Bonus items (duplicate messages, message replay) are covered by `INSERT OR IGNORE` and consumer retry behavior.
