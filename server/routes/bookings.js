const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { broadcast } = require('../events');
const { sendConfirmationEmails } = require('../email');

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

// GET /api/bookings/by-employee/:empId
router.get('/by-employee/:empId', (req, res) => {
  const empId = String(req.params.empId).trim();
  if (!empId) return res.status(400).json({ error: 'employee_id مطلوب' });
  const rows = db
    .prepare('SELECT * FROM bookings WHERE employee_id = ? ORDER BY date ASC, start_time ASC')
    .all(empId);
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
    employee_id, email, phone, services, notes
  } = req.body;

  // Required fields
  if (!room || !date || !start_time || !end_time || !name || !department || !subject) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  if (!employee_id || !String(employee_id).trim()) {
    return res.status(400).json({ success: false, error: 'رقم الوظيفي مطلوب' });
  }
  if (!email || !String(email).trim()) {
    return res.status(400).json({ success: false, error: 'البريد الإلكتروني مطلوب' });
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

  // Department — accept any non-empty string, max 100 chars
  if (typeof department !== 'string' || !department.trim()) {
    return res.status(400).json({ success: false, error: 'Department is required' });
  }
  if (department.trim().length > 100) {
    return res.status(400).json({ success: false, error: 'Department name too long' });
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
      (room, date, start_time, end_time, name, department, subject, employee_id, email, phone, services, notes, created_at, ref)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    room.toLowerCase(), date, start_time, end_time,
    name, department, subject,
    String(employee_id).trim(),
    email, phone || null,
    servicesJson, notes || null,
    createdAt, ref
  );

  const newId = Number(info.lastInsertRowid);
  broadcast('booking-changed', { action: 'created', id: newId, ref, room: room.toLowerCase(), date });
  res.json({ success: true, ref, id: newId });

  // Fire-and-forget — email failure must not affect the response
  sendConfirmationEmails({
    ref, room: room.toLowerCase(), date, start_time, end_time,
    subject, department, name,
    employee_id: String(employee_id).trim(),
    email, phone: phone || null,
    services: servicesJson, notes: notes || null,
  }).catch(err => console.error('[email] unexpected error:', err));
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
