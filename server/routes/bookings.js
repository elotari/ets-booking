const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { broadcast } = require('../events');

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function hasOverlap(s1, e1, s2, e2) {
  return s1 < e2 && e1 > s2;
}

function generateRef() {
  const year = new Date().getFullYear();
  const num  = Math.floor(1000 + Math.random() * 9000);
  return `MTG-${year}-${num}`;
}

function isValidTimeStr(t) {
  return typeof t === 'string' && /^\d{2}:\d{2}$/.test(t);
}

// GET /api/bookings?room=a&date=2026-05-12
router.get('/', (req, res) => {
  const { room, date } = req.query;
  if (!room || !date) {
    return res.status(400).json({ error: 'room and date are required' });
  }
  const rows = db
    .prepare('SELECT start_time, end_time, ref FROM bookings WHERE room = ? AND date = ?')
    .all(room.toLowerCase(), date);
  res.json(rows);
});

// GET /api/bookings/all  — must be defined before /:id
router.get('/all', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM bookings ORDER BY date ASC, start_time ASC')
    .all();
  res.json(rows);
});

// GET /api/bookings/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Booking not found' });
  res.json(row);
});

// POST /api/bookings
router.post('/', (req, res) => {
  const {
    room, date, start_time, end_time,
    name, department, subject,
    email, phone, services, notes
  } = req.body;

  // Required fields
  if (!room || !date || !start_time || !end_time || !name || !department || !subject) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  // Room
  if (!['a', 'b', 'c'].includes(room.toLowerCase())) {
    return res.status(400).json({ success: false, error: 'Invalid room. Must be a, b, or c' });
  }

  // Date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
  }

  // Weekday check (no Friday=5 or Saturday=6)
  const dateObj = new Date(date + 'T12:00:00Z');
  const dow = dateObj.getUTCDay();
  if (dow === 5 || dow === 6) {
    return res.status(400).json({ success: false, error: 'Cannot book on Friday or Saturday' });
  }

  // Time format
  if (!isValidTimeStr(start_time) || !isValidTimeStr(end_time)) {
    return res.status(400).json({ success: false, error: 'Invalid time format. Use HH:MM' });
  }

  const startMin = timeToMinutes(start_time);
  const endMin   = timeToMinutes(end_time);

  if (startMin < timeToMinutes('07:00') || endMin > timeToMinutes('15:00')) {
    return res.status(400).json({ success: false, error: 'Booking must be within 07:00–15:00' });
  }
  if (endMin <= startMin) {
    return res.status(400).json({ success: false, error: 'End time must be after start time' });
  }
  if (endMin - startMin > 120) {
    return res.status(400).json({ success: false, error: 'Maximum booking duration is 2 hours' });
  }

  // Department
  if (!['ETS', 'EO', 'EM', 'EOM&M'].includes(department)) {
    return res.status(400).json({ success: false, error: 'Invalid department' });
  }

  // Overlap check
  const existing = db
    .prepare('SELECT start_time, end_time FROM bookings WHERE room = ? AND date = ?')
    .all(room.toLowerCase(), date);

  for (const b of existing) {
    if (hasOverlap(start_time, end_time, b.start_time, b.end_time)) {
      return res.status(409).json({ success: false, error: 'Time slot already booked' });
    }
  }

  // Unique ref
  let ref;
  let attempts = 0;
  do {
    ref = generateRef();
    attempts++;
  } while (db.prepare('SELECT id FROM bookings WHERE ref = ?').get(ref) && attempts < 50);

  const servicesJson = JSON.stringify(Array.isArray(services) ? services : []);
  const createdAt    = new Date().toISOString();

  const info = db.prepare(`
    INSERT INTO bookings
      (room, date, start_time, end_time, name, department, subject, email, phone, services, notes, created_at, ref)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    room.toLowerCase(), date, start_time, end_time,
    name, department, subject,
    email || null, phone || null,
    servicesJson, notes || null,
    createdAt, ref
  );

  const newId = Number(info.lastInsertRowid);
  broadcast('booking-changed', { action: 'created', id: newId, ref, room: room.toLowerCase(), date });
  res.json({ success: true, ref, id: newId });
});

// DELETE /api/bookings/:id
router.delete('/:id', (req, res) => {
  const id   = Number(req.params.id);
  const info = db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ success: false, error: 'Booking not found' });
  }
  broadcast('booking-changed', { action: 'deleted', id });
  res.json({ success: true });
});

module.exports = router;
