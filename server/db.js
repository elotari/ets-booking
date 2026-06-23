const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'bookings.db'));

db.exec('PRAGMA journal_mode=WAL');

// Migrations — safe to run on existing DBs
try { db.exec('ALTER TABLE bookings ADD COLUMN employee_id TEXT'); } catch {}


db.exec(`
  CREATE TABLE IF NOT EXISTS bookings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    room        TEXT NOT NULL,
    date        TEXT NOT NULL,
    start_time  TEXT NOT NULL,
    end_time    TEXT NOT NULL,
    name        TEXT NOT NULL,
    department  TEXT NOT NULL,
    subject     TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    services    TEXT NOT NULL DEFAULT '[]',
    notes       TEXT,
    created_at  TEXT NOT NULL,
    ref         TEXT UNIQUE NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS cancel_requests (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id     INTEGER NOT NULL,
    booking_ref    TEXT NOT NULL,
    booking_room   TEXT NOT NULL,
    booking_date   TEXT NOT NULL,
    booking_start  TEXT NOT NULL,
    booking_end    TEXT NOT NULL,
    booking_name   TEXT NOT NULL,
    requester_name TEXT,
    reason         TEXT,
    status         TEXT NOT NULL DEFAULT 'pending',
    requested_at   TEXT NOT NULL,
    processed_at   TEXT
  )
`);

// Modification requests: user asks to extend time or add services — reviewed by secretary
try { db.exec('ALTER TABLE cancel_requests ADD COLUMN processed_at TEXT'); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS modify_requests (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id            INTEGER NOT NULL,
    booking_ref           TEXT NOT NULL,
    booking_room          TEXT NOT NULL,
    booking_date          TEXT NOT NULL,
    booking_start         TEXT NOT NULL,
    booking_end           TEXT NOT NULL,
    booking_name          TEXT NOT NULL,
    requester_name        TEXT,
    requested_add_minutes INTEGER DEFAULT 0,
    requested_new_end     TEXT,
    requested_services    TEXT,
    reason                TEXT,
    status                TEXT NOT NULL DEFAULT 'pending',
    requested_at          TEXT NOT NULL,
    processed_at          TEXT
  )
`);

// Full-edit support: a modify request can now change date/time/services
// entirely, or request a full cancellation. Old columns kept for back-compat.
try { db.exec("ALTER TABLE modify_requests ADD COLUMN requested_new_date TEXT"); } catch {}
try { db.exec("ALTER TABLE modify_requests ADD COLUMN requested_new_start TEXT"); } catch {}
try { db.exec("ALTER TABLE modify_requests ADD COLUMN requested_cancel INTEGER DEFAULT 0"); } catch {}
// requested_services now means the FULL new service list (replace), not just additions.

// Visitor suggestions for the official site (prototype feedback)
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT,
    message     TEXT NOT NULL,
    lang        TEXT,
    created_at  TEXT NOT NULL
  )
`);

module.exports = db;
