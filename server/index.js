require('dotenv').config();
const express = require('express');
const path    = require('path');
const crypto  = require('crypto');
const { addClient, removeClient } = require('./events');
const bookingsRouter       = require('./routes/bookings');
const cancelRequestsRouter = require('./routes/cancelRequests');
const modifyRequestsRouter = require('./routes/modifyRequests');

const app  = express();
const PORT = process.env.PORT || 3000;

const SECRETARY_PASSWORD = process.env.SECRETARY_PASSWORD || 'Maryam123321';
const sessions = new Set();

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

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api/bookings',        bookingsRouter);
app.use('/api/cancel-requests', cancelRequestsRouter);
app.use('/api/modify-requests', modifyRequestsRouter);

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

app.listen(PORT, () => {
  console.log(`ETS Booking System running on http://localhost:${PORT}`);
});
