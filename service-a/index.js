import express from "express";
import cors from "cors";
import Redis from "ioredis";
import axios from "axios";
import { v4 as uuid } from "uuid";
import { z } from "zod";

const app = express();
app.use(cors());
app.use(express.json());

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl, {
  retryStrategy(times) {
    const delay = Math.min(times * 500, 5000);
    return delay;
  },
  connectTimeout: 10000,
});
redis.on("error", (err) => {
  console.warn("Redis client error:", err.message);
});
const STREAM = "tickets-stream";
const GEOCODE_TIMEOUT_MS = 5000;
const GEOCODE_MAX_RETRIES = 3;

// Selected city for boundary validation (Req 5: verify within selected city)
const CITY_NAME = (process.env.CITY_NAME || "bangalore").toLowerCase();
const CITY_ALIASES = CITY_NAME === "bangalore" ? ["bangalore", "bengaluru"] : [CITY_NAME];

const schema = z.object({
  concern: z.string().min(1).max(100),
  notes: z.string().max(2000).optional(),
  userName: z.string().min(1).max(200),
  contact: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180)
});

function log(level, msg, meta = {}) {
  const entry = { level, msg, ...meta, ts: new Date().toISOString() };
  console.log(JSON.stringify(entry));
}

// Req 5: Resolve area/locality name from third-party API response
function resolveAreaName(address) {
  const fields = ["suburb", "neighbourhood", "locality", "village", "city_district", "county", "road"];
  for (const f of fields) {
    if (address[f]) return address[f];
  }
  return "Unknown";
}

// Req 5: Verify location is within selected city (checks city, town, village, state_district, state)
function isWithinCity(address) {
  const searchable = [
    address.city,
    address.town,
    address.village,
    address.state_district,
    address.county,
    address.state
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return CITY_ALIASES.some((alias) => searchable.includes(alias));
}

async function reverseGeocodeWithRetry(lat, lng) {
  let lastError;
  for (let attempt = 1; attempt <= GEOCODE_MAX_RETRIES; attempt++) {
    try {
      const res = await axios.get("https://nominatim.openstreetmap.org/reverse", {
        params: { lat, lon: lng, format: "json" },
        headers: { "User-Agent": "CivicReportingSystem/1.0" },
        timeout: GEOCODE_TIMEOUT_MS
      });
      if (res.data?.address) return res.data.address;
      throw new Error("Invalid geocode response");
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const isRateLimited = status === 429;
      log("warn", isRateLimited ? "Geocode rate limited (429)" : "Geocode attempt failed", {
        attempt,
        lat,
        lng,
        error: err.message,
        code: err.code,
        status
      });
      if (attempt < GEOCODE_MAX_RETRIES) {
        const backoffMs = isRateLimited ? 2000 : 500 * attempt;
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastError;
}

app.post("/api/v1/tickets", async (req, res) => {
  try {
    const data = schema.parse(req.body);

    // Req 5: Call third-party API (Nominatim) for reverse geocode + area resolution
    let address;
    try {
      address = await reverseGeocodeWithRetry(data.lat, data.lng);
    } catch (err) {
      log("error", "Geocoding failed after retries", {
        lat: data.lat,
        lng: data.lng,
        error: err.message
      });
      return res.status(503).json({
        error: "Location validation service temporarily unavailable",
        code: "GEOCODE_FAILED"
      });
    }

    // Req 6: If outside city → return 40x
    if (!isWithinCity(address)) {
      log("info", "Submission rejected: outside city", { lat: data.lat, lng: data.lng, city: CITY_NAME });
      return res.status(403).json({
        error: `Location is outside ${CITY_NAME.charAt(0).toUpperCase() + CITY_NAME.slice(1)} city limits`,
        code: "OUTSIDE_CITY"
      });
    }

    // Req 7: Enriched data (area from third-party API)
    const ticket = {
      id: uuid(),
      ...data,
      area: resolveAreaName(address),
      timestamp: Date.now()
    };

    // Req 7: Publish to Service B via Pub/Sub (Redis Streams)
    try {
      await redis.xadd(STREAM, "*", "data", JSON.stringify(ticket));
    } catch (pubErr) {
      log("error", "Failed to publish ticket", { ticketId: ticket.id, error: pubErr.message });
      return res.status(503).json({
        error: "Ticket created but delivery failed. Please try again.",
        code: "PUBLISH_FAILED"
      });
    }

    log("info", "Ticket created", { ticketId: ticket.id });
    // Req 7: Inside city → return 200 OK
    res.status(200).json({ ticketId: ticket.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const first = err.errors[0];
      return res.status(422).json({
        error: "Invalid input",
        code: "VALIDATION_ERROR",
        details: first ? `${first.path.join(".")}: ${first.message}` : undefined
      });
    }
    log("error", "Unexpected error", { error: err.message });
    res.status(500).json({ error: "Internal server error", code: "INTERNAL_ERROR" });
  }
});

app.listen(4000, () => {
  log("info", "Service A running", { port: 4000 });
});
