const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { broadcast } = require('../events');

// GET /api/feedback — list suggestions (newest first) for the secretary
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM feedback ORDER BY created_at DESC').all();
  res.json(rows);
});

// POST /api/feedback — visitor submits a suggestion
router.post('/', (req, res) => {
  const { name, message, lang } = req.body || {};
  if (!message || !String(message).trim()) {
    return res.status(400).json({ success: false, error: 'الرسالة مطلوبة' });
  }
  const msg = String(message).trim().slice(0, 2000);
  const nm  = name ? String(name).trim().slice(0, 120) : null;
  const createdAt = new Date().toISOString();

  const info = db.prepare(
    'INSERT INTO feedback (name, message, lang, created_at) VALUES (?, ?, ?, ?)'
  ).run(nm, msg, lang ? String(lang).slice(0, 8) : null, createdAt);

  const newId = Number(info.lastInsertRowid);
  broadcast('feedback-changed', { action: 'created', id: newId });
  res.json({ success: true, id: newId });
});

// DELETE /api/feedback/:id — secretary removes a suggestion
router.delete('/:id', (req, res) => {
  const info = db.prepare('DELETE FROM feedback WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ success: false, error: 'غير موجود' });
  broadcast('feedback-changed', { action: 'deleted', id: Number(req.params.id) });
  res.json({ success: true });
});

module.exports = router;
