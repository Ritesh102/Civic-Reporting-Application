import Redis from "ioredis";
import Database from "better-sqlite3";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 500, 5000);
    console.warn(`Redis connect retry ${times}, next in ${delay}ms`);
    return delay;
  },
  connectTimeout: 10000,
});
redis.on("error", (err) => {
  console.warn("Redis client error:", err.message);
});
const dbPath = process.env.DB_PATH || "tickets.db";
const db = new Database(dbPath);
const STREAM = "tickets-stream";

db.exec(`
CREATE TABLE IF NOT EXISTS tickets(
  id TEXT PRIMARY KEY,
  concern TEXT,
  notes TEXT,
  userName TEXT,
  contact TEXT,
  lat REAL,
  lng REAL,
  area TEXT,
  timestamp INTEGER
);
`);

function alterAddContactIfMissing() {
  try {
    db.exec("ALTER TABLE tickets ADD COLUMN contact TEXT");
  } catch {
    /* column exists */
  }
}
alterAddContactIfMissing();

async function consume() {
  let lastId = "$";
  while (true) {
    try {
      const res = await redis.xread("BLOCK", 5000, "STREAMS", STREAM, lastId);
      if (!res || !res[0]) continue;
      const [, messages] = res[0];
      for (const [id, [, data]] of messages) {
        lastId = id;
        const t = JSON.parse(data);
        db.prepare(
          "INSERT OR IGNORE INTO tickets (id, concern, notes, userName, contact, lat, lng, area, timestamp) VALUES (?,?,?,?,?,?,?,?,?)"
        ).run(
          t.id,
          t.concern,
          t.notes ?? null,
          t.userName,
          t.contact ?? null,
          t.lat,
          t.lng,
          t.area,
          t.timestamp
        );
      }
    } catch (err) {
      console.error("Consumer error:", err.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
consume();

const app = express();
app.use(cors());
app.use(express.json());

const ROLES = { OFFICER: "OFFICER", SUPERVISOR: "SUPERVISOR" };

function auth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return res.status(401).json({ error: "Missing authorization token" });
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (!req.user.role || !ROLES[req.user.role]) {
      return res.status(403).json({ error: "Invalid role" });
    }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

app.post("/internal/login", (req, res) => {
  const { role, employeeId } = req.body || {};
  if (!role || !ROLES[role]) {
    return res.status(400).json({ error: "Valid role (OFFICER or SUPERVISOR) required" });
  }
  const token = jwt.sign(
    { role, employeeId: employeeId || "demo", sub: "employee" },
    process.env.JWT_SECRET,
    { expiresIn: "24h" }
  );
  res.json({ token, role });
});

app.get("/internal/tickets", auth, (req, res) => {
  const rows = db.prepare("SELECT * FROM tickets ORDER BY timestamp DESC").all();

  if (req.user.role === ROLES.OFFICER) {
    const limited = rows.map((r) => ({
      id: r.id,
      concern: r.concern,
      area: r.area,
      timestamp: r.timestamp
    }));
    return res.json(limited);
  }

  if (req.user.role === ROLES.SUPERVISOR) {
    return res.json(rows);
  }

  res.sendStatus(403);
});

app.get("/internal/tickets/:id", auth, (req, res) => {
  const row = db.prepare("SELECT * FROM tickets WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Ticket not found" });

  if (req.user.role === ROLES.OFFICER) {
    return res.json({
      id: row.id,
      concern: row.concern,
      area: row.area,
      timestamp: row.timestamp
    });
  }

  if (req.user.role === ROLES.SUPERVISOR) {
    return res.json(row);
  }

  res.sendStatus(403);
});

app.listen(5000, () => console.log("Service B running"));
