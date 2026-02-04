How to Run or Reason About the System

### Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- Windows / macOS / Linux

### Run the System

From the **`civic-reporting-system`** directory (the folder that contains `docker-compose.yml`):

```bash
docker compose up --build
```

(If using the legacy CLI, use `docker-compose` instead.)

### Service URLs

| Service   | URL                     |
|-----------|-------------------------|
| Frontend  | http://localhost:3000   |
| Service A | http://localhost:4000   |
| Service B | http://localhost:5000   |

### User Flows

1. **Public submission:** Open http://localhost:3000 → Fill form → Report Issue. Location is validated; if inside Bangalore, ticket is created.
2. **Internal dashboard:** Open http://localhost:3000/internal → Choose Officer or Supervisor → Login → View tickets.

### Stop the System

```bash
docker compose down
```

### Optional: Run Frontend Locally (with Node/npm)

From the **`frontend`** folder:

```bash
npm install
npm run dev
```

Use the URL shown (e.g. http://localhost:3000 or 3001). Ensure Service A and Service B (and Redis) are running (e.g. via Docker) for full functionality.
