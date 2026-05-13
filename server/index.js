require('dotenv').config();
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { addClient, removeClient, broadcast } = require('./events');
const bookingsRouter       = require('./routes/bookings');
const cancelRequestsRouter = require('./routes/cancelRequests');

const app  = express();
const PORT = process.env.PORT || 3000;

const SECRETARY_PASSWORD = process.env.SECRETARY_PASSWORD || 'Maryam123321';
const sessions = new Set();

const DATA_DIR     = path.join(__dirname, '..', 'data');
const CAROUSEL_FILE = path.join(DATA_DIR, 'carousel.json');

const DEFAULT_CAROUSEL = [
  { id: 'demo-1', src: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=1600&q=80', caption: 'فريق العمل' },
  { id: 'demo-2', src: 'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1600&q=80', caption: 'اجتماعات الشركة' },
  { id: 'demo-3', src: 'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?auto=format&fit=crop&w=1600&q=80', caption: 'تعاون مهني' },
  { id: 'demo-4', src: 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1600&q=80', caption: 'بيئة عمل حديثة' },
];

function readCarousel() {
  try {
    if (!fs.existsSync(CAROUSEL_FILE)) return DEFAULT_CAROUSEL;
    const raw = fs.readFileSync(CAROUSEL_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : DEFAULT_CAROUSEL;
  } catch {
    return DEFAULT_CAROUSEL;
  }
}

function writeCarousel(items) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CAROUSEL_FILE, JSON.stringify(items, null, 2));
}

function parseCookies(req) {
  const cookies = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

function requireSecAuth(req, res, next) {
  const { sec_session } = parseCookies(req);
  if (sec_session && sessions.has(sec_session)) return next();
  res.redirect('/secretary-login');
}

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/bookings',        bookingsRouter);
app.use('/api/cancel-requests', cancelRequestsRouter);

// SSE — real-time push to all open secretary dashboards
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if behind proxy
  res.flushHeaders();

  res.write('event: connected\ndata: ok\n\n');
  addClient(res);

  // Heartbeat every 25 s to keep connection alive through proxies
  const hb = setInterval(() => {
    try { res.write('event: ping\ndata: \n\n'); } catch { clearInterval(hb); }
  }, 25000);

  req.on('close', () => {
    clearInterval(hb);
    removeClient(res);
  });
});

// Secretary login page (public)
app.get('/secretary-login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'secretary-login.html'));
});

// Secretary auth endpoints
app.post('/api/secretary/login', (req, res) => {
  const { password } = req.body || {};
  if (password === SECRETARY_PASSWORD) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `sec_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800`);
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'كلمة المرور غير صحيحة' });
  }
});

app.post('/api/secretary/logout', (req, res) => {
  const { sec_session } = parseCookies(req);
  sessions.delete(sec_session);
  res.setHeader('Set-Cookie', 'sec_session=; Path=/; HttpOnly; Max-Age=0');
  res.json({ success: true });
});

// Protected secretary dashboard
app.get('/secretary', requireSecAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'secretary.html'));
});

// ── Carousel API ──
app.get('/api/carousel', (req, res) => {
  res.json(readCarousel());
});

function requireSecAuthApi(req, res, next) {
  const { sec_session } = parseCookies(req);
  if (sec_session && sessions.has(sec_session)) return next();
  res.status(401).json({ error: 'غير مصرح' });
}

app.post('/api/carousel', requireSecAuthApi, (req, res) => {
  const { src, caption } = req.body || {};
  if (!src || typeof src !== 'string') {
    return res.status(400).json({ error: 'الصورة مطلوبة' });
  }
  const trimmed = src.trim();
  const ok = trimmed.startsWith('data:image/') || /^https?:\/\//i.test(trimmed) || trimmed.startsWith('/');
  if (!ok) return res.status(400).json({ error: 'رابط الصورة غير صالح' });

  const items = readCarousel();
  const item = {
    id: crypto.randomBytes(8).toString('hex'),
    src: trimmed,
    caption: (caption || '').toString().slice(0, 120),
  };
  items.push(item);
  writeCarousel(items);
  broadcast('carousel_updated', {});
  res.json({ success: true, item });
});

app.delete('/api/carousel/:id', requireSecAuthApi, (req, res) => {
  const items = readCarousel();
  const next  = items.filter(it => it.id !== req.params.id);
  if (next.length === items.length) {
    return res.status(404).json({ error: 'الصورة غير موجودة' });
  }
  writeCarousel(next);
  broadcast('carousel_updated', {});
  res.json({ success: true });
});

app.post('/api/carousel/reorder', requireSecAuthApi, (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });
  const items = readCarousel();
  const map   = new Map(items.map(it => [it.id, it]));
  const reordered = ids.map(id => map.get(id)).filter(Boolean);
  for (const it of items) if (!ids.includes(it.id)) reordered.push(it);
  writeCarousel(reordered);
  broadcast('carousel_updated', {});
  res.json({ success: true });
});

app.post('/api/carousel/reset', requireSecAuthApi, (req, res) => {
  writeCarousel(DEFAULT_CAROUSEL);
  broadcast('carousel_updated', {});
  res.json({ success: true, items: DEFAULT_CAROUSEL });
});

app.listen(PORT, () => {
  console.log(`ETS Booking System running on http://localhost:${PORT}`);
});
