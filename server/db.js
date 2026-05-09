const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs   = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'bookings.db'));

db.exec('PRAGMA journal_mode=WAL');

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

module.exports = db;
