const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { broadcast } = require('../events');

function timeToMinutes(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function minToTime(m){ const hh=Math.floor(m/60); const mm=m%60; return String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'); }
function hasOverlap(s1,e1,s2,e2){ return s1<e2 && e1>s2; }

// GET /api/modify-requests
router.get('/', (req,res)=>{
  const rows = db.prepare(`
    SELECT mr.*, b.department, b.subject, b.employee_id as booking_employee_id
    FROM modify_requests mr
    LEFT JOIN bookings b ON mr.booking_id = b.id
    ORDER BY mr.requested_at DESC
  `).all();
  res.json(rows);
});

// POST /api/modify-requests
router.post('/', (req,res)=>{
  const { booking_id, requester_name, additional_minutes, added_services, reason } = req.body || {};
  if (!booking_id) return res.status(400).json({ success:false, error:'booking_id مطلوب' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(booking_id));
  if (!booking) return res.status(404).json({ success:false, error:'الحجز غير موجود' });

  const existing = db.prepare('SELECT id FROM modify_requests WHERE booking_id = ? AND status = ?').get(Number(booking_id), 'pending');
  if (existing) return res.status(409).json({ success:false, error:'يوجد طلب تعديل معلق لهذا الحجز مسبقاً' });

  const mins = Number(additional_minutes) || 0;
  const currentEnd = booking.end_time;
  const newEndMin = timeToMinutes(currentEnd) + mins;
  const requestedNewEnd = minToTime(newEndMin);

  const servicesJson = JSON.stringify(Array.isArray(added_services) ? added_services : []);
  const requestedAt = new Date().toISOString();

  const info = db.prepare(`
    INSERT INTO modify_requests
      (booking_id, booking_ref, booking_room, booking_date, booking_start, booking_end, booking_name, requester_name, requested_add_minutes, requested_new_end, requested_services, reason, status, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    Number(booking_id), booking.ref, booking.room, booking.date, booking.start_time, booking.end_time, booking.name,
    requester_name ? String(requester_name).trim() : null,
    mins, requestedNewEnd, servicesJson, reason ? String(reason).trim() : null, requestedAt
  );

  const newId = Number(info.lastInsertRowid);
  broadcast('modify-request-changed', { action:'created', id: newId });
  res.json({ success:true, id: newId });
});

// PATCH /api/modify-requests/:id/approve
router.patch('/:id/approve', (req,res)=>{
  const id = Number(req.params.id);
  const mr = db.prepare('SELECT * FROM modify_requests WHERE id = ?').get(id);
  if (!mr) return res.status(404).json({ success:false, error:'طلب التعديل غير موجود' });
  if (mr.status !== 'pending') return res.status(400).json({ success:false, error:'الطلب ليس معلقاً' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(mr.booking_id));
  if (!booking) return res.status(404).json({ success:false, error:'الحجز المرتبط غير موجود' });

  const newEnd = mr.requested_new_end;
  if (!/^[0-2]\d:[0-5]\d$/.test(newEnd)) return res.status(400).json({ success:false, error:'تنسيق وقت النهاية الجديد غير صالح' });

  const newEndMin = timeToMinutes(newEnd);
  if (newEndMin > timeToMinutes('15:00')) return res.status(400).json({ success:false, error:'لا يمكن تمديد الحجز خارج 07:00–15:00' });

  // Check overlap with other bookings on same room/date excluding current booking
  const others = db.prepare('SELECT id, start_time, end_time FROM bookings WHERE room = ? AND date = ? AND id != ?').all(mr.booking_room, mr.booking_date, Number(mr.booking_id));
  for (const o of others) {
    if (hasOverlap(booking.start_time, newEnd, o.start_time, o.end_time)) {
      return res.status(409).json({ success:false, error:'لا يمكن تطبيق التعديل لأنّه يتداخل مع حجز آخر' });
    }
  }

  // Update booking end time and services (merge)
  const existingServices = JSON.parse(booking.services || '[]');
  const requestedServices = JSON.parse(mr.requested_services || '[]');
  const merged = Array.from(new Set([...existingServices, ...requestedServices]));

  db.prepare('UPDATE bookings SET end_time = ?, services = ? WHERE id = ?').run(newEnd, JSON.stringify(merged), Number(mr.booking_id));

  const processedAt = new Date().toISOString();
  db.prepare('UPDATE modify_requests SET status = ?, processed_at = ? WHERE id = ?').run('approved', processedAt, id);

  broadcast('booking-changed', { action:'updated', id: Number(mr.booking_id) });
  broadcast('modify-request-changed', { action:'approved', id });

  res.json({ success:true });
});

// PATCH /api/modify-requests/:id/reject
router.patch('/:id/reject', (req,res)=>{
  const id = Number(req.params.id);
  const mr = db.prepare('SELECT * FROM modify_requests WHERE id = ?').get(id);
  if (!mr) return res.status(404).json({ success:false, error:'طلب التعديل غير موجود' });
  if (mr.status !== 'pending') return res.status(400).json({ success:false, error:'الطلب ليس معلقاً' });
  const processedAt = new Date().toISOString();
  db.prepare('UPDATE modify_requests SET status = ?, processed_at = ? WHERE id = ?').run('rejected', processedAt, id);
  broadcast('modify-request-changed', { action:'rejected', id });
  res.json({ success:true });
});

module.exports = router;
