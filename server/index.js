require('dotenv').config();
const express = require('express');
const path    = require('path');
const { addClient, removeClient } = require('./events');
const bookingsRouter       = require('./routes/bookings');
const cancelRequestsRouter = require('./routes/cancelRequests');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
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

app.get('/secretary', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'secretary.html'));
});

app.listen(PORT, () => {
  console.log(`ETS Booking System running on http://localhost:${PORT}`);
});
