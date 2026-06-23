const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { broadcast } = require('../events');

function timeToMinutes(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function hasOverlap(s1,e1,s2,e2){ return s1<e2 && e1>s2; }
function isValidTimeStr(t){ return typeof t==='string' && /^\d{2}:\d{2}$/.test(t); }
function isValidDateStr(d){ return typeof d==='string' && /^\d{4}-\d{2}-\d{2}$/.test(d); }

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
// Body: { booking_id, requester_name, reason,
//         cancel: bool,                       // full cancellation request
//         new_date, new_start, new_end,       // full new time (optional — defaults to current)
//         services: [..] }                    // FULL new service list (replaces old)
router.post('/', (req,res)=>{
  const { booking_id, requester_name, reason, cancel } = req.body || {};
  if (!booking_id) return res.status(400).json({ success:false, error:'booking_id مطلوب' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(booking_id));
  if (!booking) return res.status(404).json({ success:false, error:'الحجز غير موجود' });

  const existing = db.prepare('SELECT id FROM modify_requests WHERE booking_id = ? AND status = ?').get(Number(booking_id), 'pending');
  if (existing) return res.status(409).json({ success:false, error:'يوجد طلب معلق لهذا الحجز مسبقاً' });

  const requestedAt = new Date().toISOString();
  const isCancel = !!cancel;

  // Cancellation request — no time validation needed
  if (isCancel) {
    const info = db.prepare(`
      INSERT INTO modify_requests
        (booking_id, booking_ref, booking_room, booking_date, booking_start, booking_end, booking_name,
         requester_name, requested_add_minutes, requested_new_end, requested_new_date, requested_new_start,
         requested_services, requested_cancel, reason, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, NULL, NULL, 1, ?, 'pending', ?)
    `).run(
      Number(booking_id), booking.ref, booking.room, booking.date, booking.start_time, booking.end_time, booking.name,
      requester_name ? String(requester_name).trim() : null,
      reason ? String(reason).trim() : null, requestedAt
    );
    const newId = Number(info.lastInsertRowid);
    broadcast('modify-request-changed', { action:'created', id: newId });
    return res.json({ success:true, id: newId });
  }

  // Full edit — resolve new values (fall back to current booking values)
  const newDate  = req.body.new_date  || booking.date;
  const newStart = req.body.new_start || booking.start_time;
  const newEnd   = req.body.new_end   || booking.end_time;

  if (!isValidDateStr(newDate)) return res.status(400).json({ success:false, error:'تنسيق التاريخ غير صالح' });
  if (!isValidTimeStr(newStart) || !isValidTimeStr(newEnd)) {
    return res.status(400).json({ success:false, error:'تنسيق الوقت غير صالح' });
  }
  const sMin = timeToMinutes(newStart), eMin = timeToMinutes(newEnd);
  if (eMin <= sMin) return res.status(400).json({ success:false, error:'وقت النهاية يجب أن يكون بعد البداية' });
  if (sMin < timeToMinutes('07:00') || eMin > timeToMinutes('15:00')) {
    return res.status(400).json({ success:false, error:'الحجز يجب أن يكون ضمن 07:00–15:00' });
  }
  if (eMin - sMin > 120) return res.status(400).json({ success:false, error:'أقصى مدة للحجز ساعتان' });

  // Weekend guard
  const dow = new Date(newDate + 'T12:00:00Z').getUTCDay();
  if (dow === 5 || dow === 6) return res.status(400).json({ success:false, error:'لا يمكن الحجز يوم الجمعة أو السبت' });

  // Services = full new list (replace)
  const services = Array.isArray(req.body.services) ? req.body.services : JSON.parse(booking.services || '[]');
  const servicesJson = JSON.stringify(services);

  // Detect "no change" — same date/time/services as current
  const sameTime = newDate === booking.date && newStart === booking.start_time && newEnd === booking.end_time;
  const sameSvc  = JSON.stringify([...services].sort()) === JSON.stringify([...JSON.parse(booking.services||'[]')].sort());
  if (sameTime && sameSvc) {
    return res.status(400).json({ success:false, error:'لم تقم بأي تغيير على الحجز' });
  }

  // Pre-check overlap at request time (gives the user immediate feedback);
  // re-checked again on approve in case other bookings changed meanwhile.
  const others = db.prepare('SELECT start_time, end_time FROM bookings WHERE room = ? AND date = ? AND id != ?')
    .all(booking.room, newDate, Number(booking_id));
  for (const o of others) {
    if (hasOverlap(newStart, newEnd, o.start_time, o.end_time)) {
      return res.status(409).json({ success:false, error:'الوقت الجديد يتعارض مع حجز آخر، الرجاء اختيار وقت متاح' });
    }
  }

  const addMinutes = eMin - timeToMinutes(booking.end_time); // legacy column, informational

  const info = db.prepare(`
    INSERT INTO modify_requests
      (booking_id, booking_ref, booking_room, booking_date, booking_start, booking_end, booking_name,
       requester_name, requested_add_minutes, requested_new_end, requested_new_date, requested_new_start,
       requested_services, requested_cancel, reason, status, requested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?)
  `).run(
    Number(booking_id), booking.ref, booking.room, booking.date, booking.start_time, booking.end_time, booking.name,
    requester_name ? String(requester_name).trim() : null,
    addMinutes, newEnd, newDate, newStart,
    servicesJson, reason ? String(reason).trim() : null, requestedAt
  );

  const newId = Number(info.lastInsertRowid);
  broadcast('modify-request-changed', { action:'created', id: newId });
  res.json({ success:true, id: newId });
});

// PATCH /api/modify-requests/:id/approve
router.patch('/:id/approve', (req,res)=>{
  const id = Number(req.params.id);
  const mr = db.prepare('SELECT * FROM modify_requests WHERE id = ?').get(id);
  if (!mr) return res.status(404).json({ success:false, error:'الطلب غير موجود' });
  if (mr.status !== 'pending') return res.status(400).json({ success:false, error:'الطلب ليس معلقاً' });

  const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(mr.booking_id));
  if (!booking) return res.status(404).json({ success:false, error:'الحجز المرتبط غير موجود' });

  // Cancellation request → delete the booking
  if (mr.requested_cancel) {
    db.prepare('DELETE FROM bookings WHERE id = ?').run(Number(mr.booking_id));
    const processedAt = new Date().toISOString();
    db.prepare('UPDATE modify_requests SET status = ?, processed_at = ? WHERE id = ?').run('approved', processedAt, id);
    broadcast('booking-changed', { action:'deleted', id: Number(mr.booking_id) });
    broadcast('modify-request-changed', { action:'approved', id });
    return res.json({ success:true });
  }

  // Full edit — resolve target values
  const newDate  = mr.requested_new_date  || booking.date;
  const newStart = mr.requested_new_start || booking.start_time;
  const newEnd   = mr.requested_new_end   || booking.end_time;

  if (!isValidTimeStr(newStart) || !isValidTimeStr(newEnd) || !isValidDateStr(newDate)) {
    return res.status(400).json({ success:false, error:'قيم التعديل غير صالحة' });
  }
  const sMin = timeToMinutes(newStart), eMin = timeToMinutes(newEnd);
  if (eMin <= sMin || sMin < timeToMinutes('07:00') || eMin > timeToMinutes('15:00')) {
    return res.status(400).json({ success:false, error:'الوقت الجديد خارج النطاق المسموح' });
  }

  // Re-check overlap with OTHER bookings on the target room/date
  const others = db.prepare('SELECT start_time, end_time FROM bookings WHERE room = ? AND date = ? AND id != ?')
    .all(booking.room, newDate, Number(mr.booking_id));
  for (const o of others) {
    if (hasOverlap(newStart, newEnd, o.start_time, o.end_time)) {
      return res.status(409).json({ success:false, error:'لا يمكن تطبيق التعديل لأنّه يتداخل مع حجز آخر' });
    }
  }

  const services = mr.requested_services != null ? mr.requested_services : booking.services;

  db.prepare('UPDATE bookings SET date = ?, start_time = ?, end_time = ?, services = ? WHERE id = ?')
    .run(newDate, newStart, newEnd, services, Number(mr.booking_id));

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
  if (!mr) return res.status(404).json({ success:false, error:'الطلب غير موجود' });
  if (mr.status !== 'pending') return res.status(400).json({ success:false, error:'الطلب ليس معلقاً' });
  const processedAt = new Date().toISOString();
  db.prepare('UPDATE modify_requests SET status = ?, processed_at = ? WHERE id = ?').run('rejected', processedAt, id);
  broadcast('modify-request-changed', { action:'rejected', id });
  res.json({ success:true });
});

module.exports = router;
