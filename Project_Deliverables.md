# Civic Issue Reporting System — Deliverables

**For a Better City** — A location-aware civic issue reporting tool for Bangalore city government.

*This document provides: (1) High-level architecture, (2) API contracts, (3) RBAC design, (4) Design decisions and tradeoffs, (6) README / how to run, (7) Data model. Code (repo/zip) is excluded per request.*

---

## 1. High-Level Architecture Diagram / Writeup

### Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         CIVIC ISSUE REPORTING SYSTEM                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                   │
│  ┌──────────────────┐                                                            │
│  │     BROWSER       │  Geolocation API (lat/lng)                                 │
│  │  (Resident)       │◄────────────────────────────► Device GPS / Manual Coords   │
│  └────────┬─────────┘                                                            │
│           │                                                                       │
│           │ POST /api/v1/tickets                                                  │
│           ▼                                                                       │
│  ┌──────────────────┐                                                            │
│  │    FRONTEND       │  React (Vite) SPA, Port 3000                                │
│  │  Public (/)       │  Public form + Internal dashboard (/internal)               │
│  │  Internal (/internal)                                                          │
│  └────────┬─────────┘                                                            │
│           │ HTTP                                                                  │
│           ▼                                                                       │
│  ┌──────────────────┐         ┌─────────────────────┐                            │
│  │    SERVICE A      │────────►│  Nominatim (OSM)    │  Reverse Geocode            │
│  │  Intake/Valid     │  API    │  Third-Party API   │  Resolve area/locality     │
│  │  Port 4000        │◄────────│                    │  Verify city boundary       │
│  └────────┬─────────┘         └─────────────────────┘                            │
│           │                                                                       │
│           │ XADD (Redis Streams)                                                  │
│           ▼                                                                       │
│  ┌──────────────────┐                                                            │
│  │      REDIS       │  Stream: tickets-stream                                    │
│  │  Port 6379       │  Pub/Sub message broker                                    │
│  └────────┬─────────┘                                                            │
│           │ XREAD (Consumer)                                                      │
│           ▼                                                                       │
│  ┌──────────────────┐         ┌─────────────────────┐                            │
│  │    SERVICE B     │────────►│  SQLite            │  tickets.db                 │
│  │  Storage & API   │  INSERT │  Persistent storage│  ./data/tickets.db          │
│  │  Port 5000       │         └─────────────────────┘                            │
│  └────────┬─────────┘                                                            │
│           │                                                                       │
│           │ GET /internal/tickets (JWT Auth)                                      │
│           ▼                                                                       │
│  ┌──────────────────┐                                                            │
│  │  GOV EMPLOYEES   │  Internal UI (/internal)                                   │
│  │  Officer/Super   │  Role-based ticket visibility                              │
│  └──────────────────┘                                                            │
│                                                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Architecture Writeup

The system uses a **microservices-style** design with clear separation of concerns:

| Component    | Responsibility |
|-------------|----------------|
| **Frontend** | React (Vite) SPA. Public form for residents (no auth); internal dashboard for government staff (JWT). Routes: `/` (report issue), `/internal` (ticket dashboard). |
| **Service A** | Stateless intake API. Validates input, calls Nominatim for reverse geocoding and city verification, publishes enriched tickets to Redis Streams. Returns 403 if outside city; 200 and publish if inside. |
| **Redis** | Message broker (Redis Streams). Decouples intake from storage. At-least-once delivery. |
| **Service B** | Background consumer + HTTP API. Consumes stream, stores in SQLite. Serves internal API with JWT + RBAC. |
| **Nominatim** | Third-party OpenStreetMap service. Reverse geocodes lat/lng to address; used for area name and city boundary check. |

**Data flow:** Resident submits → Service A validates + geocodes → Publishes to Redis → Service B consumes → Stores in SQLite → Gov employees query via internal API with role-based visibility.

---

## 2. API Contracts with Example Requests and Responses

### Public API (Service A — Port 4000)

#### `POST /api/v1/tickets`

Submit a civic issue. No authentication required.

**Example Request:**

```http
POST http://localhost:4000/api/v1/tickets
Content-Type: application/json

{
  "concern": "Pothole",
  "notes": "Large pothole near MG Road junction, causing traffic issues",
  "userName": "Rahul Kumar",
  "contact": "rahul@email.com",
  "lat": 12.9716,
  "lng": 77.5946
}
```

**Example Response — Success (200 OK):**

```json
{
  "ticketId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example Response — Outside City (403 Forbidden):**

```json
{
  "error": "Location is outside Bangalore city limits",
  "code": "OUTSIDE_CITY"
}
```

**Example Response — Validation Error (422 Unprocessable Entity):**

```json
{
  "error": "Invalid input",
  "code": "VALIDATION_ERROR",
  "details": "concern: Required"
}
```

**Example Response — Geocoding Failed (503 Service Unavailable):**

```json
{
  "error": "Location validation service temporarily unavailable",
  "code": "GEOCODE_FAILED"
}
```

**Example Response — Publish Failed (503):**

```json
{
  "error": "Ticket created but delivery failed. Please try again.",
  "code": "PUBLISH_FAILED"
}
```

**Request field constraints:**

| Field    | Type   | Required | Constraints     | Description     |
|----------|--------|----------|-----------------|-----------------|
| concern  | string | yes      | 1–100 chars     | Issue type      |
| notes    | string | no       | max 2000 chars  | Description     |
| userName | string | yes      | 1–200 chars     | Reporter name   |
| contact  | string | no       | max 100 chars   | Phone or email  |
| lat      | number | yes      | -90 to 90        | Latitude        |
| lng      | number | yes      | -180 to 180      | Longitude       |

---

### Internal API (Service B — Port 5000)

#### `POST /internal/login`

Obtain JWT for internal access. No prior authentication.

**Example Request:**

```http
POST http://localhost:5000/internal/login
Content-Type: application/json

{
  "role": "SUPERVISOR",
  "employeeId": "emp001"
}
```

**Example Response — Success (200 OK):**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiU1VQRVJWSVNPUiIsImVtcGxveWVlSWQiOiJlbXAwMDEiLCJzdWIiOiJlbXBsb3llZSIsImlhdCI6MTcwNjgxMjAwMCwiZXhwIjoxNzA2ODk4NDAwfQ.xxxxx",
  "role": "SUPERVISOR"
}
```

**Example Response — Invalid Role (400 Bad Request):**

```json
{
  "error": "Valid role (OFFICER or SUPERVISOR) required"
}
```

---

#### `GET /internal/tickets`

List all tickets. Requires `Authorization: Bearer <token>`.

**Example Request:**

```http
GET http://localhost:5000/internal/tickets
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Example Response — Supervisor (200 OK):** Full ticket data

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "concern": "Pothole",
    "notes": "Large pothole near MG Road",
    "userName": "Rahul Kumar",
    "contact": "rahul@email.com",
    "lat": 12.9716,
    "lng": 77.5946,
    "area": "MG Road",
    "timestamp": 1706812345678
  }
]
```

**Example Response — Officer (200 OK):** Limited fields

```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "concern": "Pothole",
    "area": "MG Road",
    "timestamp": 1706812345678
  }
]
```

**Example Response — Missing Token (401 Unauthorized):**

```json
{
  "error": "Missing authorization token"
}
```

**Example Response — Invalid Token (401):**

```json
{
  "error": "Invalid or expired token"
}
```

---

#### `GET /internal/tickets/:id`

Get a single ticket by ID. Requires `Authorization: Bearer <token>`.

**Example Request:**

```http
GET http://localhost:5000/internal/tickets/550e8400-e29b-41d4-a716-446655440000
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Example Response — Supervisor (200 OK):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "concern": "Pothole",
  "notes": "Large pothole near MG Road",
  "userName": "Rahul Kumar",
  "contact": "rahul@email.com",
  "lat": 12.9716,
  "lng": 77.5946,
  "area": "MG Road",
  "timestamp": 1706812345678
}
```

**Example Response — Officer (200 OK):** Limited fields (id, concern, area, timestamp only)

**Example Response — Not Found (404):**

```json
{
  "error": "Ticket not found"
}
```

---

## 3. RBAC Design and Rules

### Roles

| Role         | Description                     |
|--------------|---------------------------------|
| **OFFICER**   | Field officer; limited ticket visibility |
| **SUPERVISOR**| Supervisor; full ticket visibility       |

### Permissions Matrix

| Action           | OFFICER        | SUPERVISOR     |
|------------------|----------------|----------------|
| Login            | ✓              | ✓              |
| List tickets     | ✓ (limited)    | ✓ (full)       |
| Get ticket by ID | ✓ (limited)    | ✓ (full)       |

### Ticket Field Visibility

| Field     | OFFICER | SUPERVISOR |
|-----------|---------|------------|
| id        | ✓       | ✓          |
| concern   | ✓       | ✓          |
| area      | ✓       | ✓          |
| timestamp | ✓       | ✓          |
| notes     | ✗       | ✓          |
| userName  | ✗       | ✓          |
| contact   | ✗       | ✓          |
| lat       | ✗       | ✓          |
| lng       | ✗       | ✓          |

### RBAC Rules

1. **Server-side enforcement:** RBAC is enforced in Service B. The client cannot override visibility.
2. **JWT payload:** Role is stored in the JWT payload; token is signed with `JWT_SECRET`.
3. **401 Unauthorized:** Missing token, invalid token, or expired token.
4. **403 Forbidden:** Valid token but invalid/unknown role.
5. **No role escalation:** The login endpoint accepts only `OFFICER` or `SUPERVISOR`; no privilege elevation.

---

## 4. Explanation of Design Decisions and Tradeoffs

### a. Nominatim (OpenStreetMap)

**Rationale:**  
Nominatim was selected for reverse geocoding because it is free to use, requires no API key, and provides reliable locality and area names. This makes it suitable for validating whether a reported issue lies within the Bangalore city boundary without introducing additional costs.

**Tradeoff:**  
The service is rate-limited and may be slightly less accurate than commercial providers. To mitigate this, retries, exponential backoff, HTTP 429 handling, and a 503 fallback response are implemented.

---

### b. Redis Streams

**Rationale:**  
Redis Streams acts as a lightweight message broker between the intake and storage services. It enables asynchronous communication, at-least-once delivery, and loose coupling while remaining simpler to configure and operate than Kafka for small-to-medium workloads.

**Tradeoff:**  
A single Redis instance may become a bottleneck under high traffic. For larger production systems, clustering Redis or migrating to Kafka would provide better scalability and fault tolerance.

---

### c. SQLite

**Rationale:**  
SQLite was chosen because it is embedded, requires no separate database server, and stores data in a single file. This simplifies development, deployment, and local testing while minimizing operational overhead.

**Tradeoff:**  
SQLite supports only one writer at a time, limiting concurrency. It is not ideal for high-throughput production systems, where PostgreSQL or MySQL would be more appropriate.

---

### d. JWT for Internal Authentication

**Rationale:**  
JWT enables stateless authentication, eliminating the need for server-side sessions. This simplifies scaling and keeps the authentication mechanism lightweight and easy to implement.

**Tradeoff:**  
Token revocation and lifecycle management are more complex. In production environments, OAuth2 or SSO with refresh tokens would provide stronger security and better control.

---

### e. HTTP 403 for Outside City Requests

**Rationale:**  
Requests outside the supported city boundary are treated as a jurisdiction restriction rather than invalid input. HTTP 403 (Forbidden) accurately communicates that the server understands the request but refuses to process it.

**Tradeoff:**  
Requires clear separation between:
- 422 → validation errors  
- 403 → jurisdiction restrictions  

This adds slightly more logic but improves semantic clarity.

---

### f. INSERT OR IGNORE for Database Writes

**Rationale:**  
Used to ensure idempotency when processing Redis Stream messages. If a message is replayed or duplicated, the database safely ignores duplicate inserts without causing failures.

**Tradeoff:**  
Relies on UUID primary keys and silently ignores duplicates. Without proper monitoring or logging, rare data inconsistencies may go unnoticed.

---

### g. Stateless Service A (Intake Service)

**Rationale:**  
Service A is designed to be completely stateless so that it can scale horizontally behind a load balancer. No session storage or shared memory is required, improving scalability and reliability.

**Tradeoff:**  
Each request must contain all necessary information since no session context is maintained. This may slightly increase repeated validations.

---

### h. Decoupled Pub/Sub Architecture

**Rationale:**  
Separating intake and storage through Redis Streams allows both services to scale independently. This prevents slow database operations from blocking user submissions and improves fault tolerance.

**Tradeoff:**  
The system becomes eventually consistent. A ticket may be accepted (200 OK) but not immediately visible in the database until the consumer processes the event.

---

### i. React (Vite) Frontend

**Rationale:**  
React provides a component-based structure, routing capabilities, and better maintainability for the user interface. Vite offers fast builds and an efficient development experience.

**Tradeoff:**  
Requires a build step before deployment. Docker must compile and serve static assets, adding minor complexity compared to plain static HTML.


### Third-Party API (Nominatim)

- **Choice:** OpenStreetMap Nominatim.
- **Handling:** 5s timeout, 3 retries with backoff; 429 (rate limit) gets longer backoff.
- **On failure:** 503 with `GEOCODE_FAILED`; user can retry.

### Pub/Sub (Redis Streams)

- **Delivery:** At-least-once; consumer tracks last processed message ID.
- **Failure:** Consumer retries on error; `INSERT OR IGNORE` prevents duplicate tickets on replay.

---

### Environment Variables

| Variable   | Service   | Description                                |
|------------|-----------|--------------------------------------------|
| REDIS_URL  | A, B      | Redis connection (e.g. `redis://redis:6379`) |
| JWT_SECRET | B         | Secret for signing JWTs                    |
| DB_PATH    | B         | SQLite file path (default: `tickets.db`)   |
| CITY_NAME  | A         | City for boundary check (default: `bangalore`) |

**Note:** Set `JWT_SECRET` via environment in production; avoid hardcoding.

### Project Structure (High Level)

```
civic-reporting-system/
├── docker-compose.yml
├── frontend/             # React (Vite) SPA
├── service-a/            # Intake, validation, pub/sub
├── service-b/            # Storage, internal API, RBAC
├── data/                 # SQLite DB (created at runtime)
├── README.md
└── DOCUMENTATION.md
```

---

## 7. Data Model

### Table: `tickets`

| Column    | Type    | Constraints | Description                          |
|-----------|---------|-------------|--------------------------------------|
| id        | TEXT    | PRIMARY KEY | UUID v4                              |
| concern   | TEXT    |             | Issue type (e.g. Pothole, Garbage)   |
| notes     | TEXT    |             | Reporter description                 |
| userName  | TEXT    |             | Reporter name                        |
| contact   | TEXT    | nullable    | Phone or email                       |
| lat       | REAL    |             | Latitude                             |
| lng       | REAL    |             | Longitude                            |
| area      | TEXT    |             | Resolved locality (from Nominatim)   |
| timestamp | INTEGER |             | Unix timestamp (milliseconds)        |

### Entity Relationship

Single table; no foreign keys. Each ticket is independent.

### Sample Row

```sql
INSERT INTO tickets VALUES (
  '550e8400-e29b-41d4-a716-446655440000',
  'Pothole',
  'Large pothole near junction',
  'Rahul Kumar',
  'rahul@email.com',
  12.9716,
  77.5946,
  'MG Road',
  1706812345678
);
```

---
