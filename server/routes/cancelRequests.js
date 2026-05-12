const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { broadcast } = require('../events');

// GET /api/cancel-requests
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT cr.*, b.department, b.subject, b.employee_id as booking_employee_id
    FROM cancel_requests cr
    LEFT JOIN bookings b ON cr.booking_id = b.id
    ORDER BY cr.requested_at DESC
  `).all();
  res.json(rows);
});

// POST /api/cancel-requests
router.post('/', (req, res) => {
  const { booking_id, requester_name, reason } = req.body;

  if (!booking_id) {
    return res.status(400).json({ success: false, error: 'booking_id مطلوب' });
  }

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(booking_id));
  if (!booking) {
    return res.status(404).json({ success: false, error: 'الحجز غير موجود' });
  }

  const existing = db.prepare(
    'SELECT id FROM cancel_requests WHERE booking_id = ? AND status = ?'
  ).get(Number(booking_id), 'pending');
  if (existing) {
    return res.status(409).json({ success: false, error: 'يوجد طلب إلغاء معلق لهذا الحجز مسبقاً' });
  }

  const requestedAt = new Date().toISOString();

  const info = db.prepare(`
    INSERT INTO cancel_requests
      (booking_id, booking_ref, booking_room, booking_date, booking_start, booking_end,
       booking_name, requester_name, reason, status, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    Number(booking_id),
    booking.ref,
    booking.room,
    booking.date,
    booking.start_time,
    booking.end_time,
    booking.name,
    requester_name ? String(requester_name).trim() : null,
    reason ? String(reason).trim() : null,
    requestedAt
  );

  const newId = Number(info.lastInsertRowid);
  broadcast('cancel-request-changed', { action: 'created', id: newId });
  res.json({ success: true, id: newId });
});

// PATCH /api/cancel-requests/:id/approve
router.patch('/:id/approve', (req, res) => {
  const id = Number(req.params.id);
  const cr = db.prepare('SELECT * FROM cancel_requests WHERE id = ?').get(id);
  if (!cr) return res.status(404).json({ success: false, error: 'طلب الإلغاء غير موجود' });
  if (cr.status !== 'pending') return res.status(400).json({ success: false, error: 'الطلب ليس معلقاً' });

  const processedAt = new Date().toISOString();

  db.prepare('DELETE FROM bookings WHERE id = ?').run(cr.booking_id);
  db.prepare('UPDATE cancel_requests SET status = ?, processed_at = ? WHERE id = ?')
    .run('approved', processedAt, id);

  broadcast('booking-changed', { action: 'deleted', id: cr.booking_id });
  broadcast('cancel-request-changed', { action: 'approved', id });

  res.json({ success: true });
});

// PATCH /api/cancel-requests/:id/reject
router.patch('/:id/reject', (req, res) => {
  const id = Number(req.params.id);
  const cr = db.prepare('SELECT * FROM cancel_requests WHERE id = ?').get(id);
  if (!cr) return res.status(404).json({ success: false, error: 'طلب الإلغاء غير موجود' });
  if (cr.status !== 'pending') return res.status(400).json({ success: false, error: 'الطلب ليس معلقاً' });

  const processedAt = new Date().toISOString();

  db.prepare('UPDATE cancel_requests SET status = ?, processed_at = ? WHERE id = ?')
    .run('rejected', processedAt, id);

  broadcast('cancel-request-changed', { action: 'rejected', id });

  res.json({ success: true });
});

module.exports = router;
