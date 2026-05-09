# ETS Meeting Room Booking System

A full-stack meeting room booking web application — Arabic RTL, real-time dashboard.

## Tech Stack

- Frontend: Vanilla HTML/CSS/JS (Arabic RTL, Cairo font)
- Backend: Node.js + Express
- Database: SQLite (built-in `node:sqlite`, no compilation)
- Real-time: Server-Sent Events (SSE) — zero extra packages

## Project Structure

```
/public          → Frontend (static files)
  index.html     → Employee 4-step booking wizard
  secretary.html → Secretary dashboard (live updates)
  style.css      → Design system
/server
  index.js       → Express app + SSE endpoint
  db.js          → SQLite setup
  events.js      → SSE broadcast manager
  /routes
    bookings.js  → All API routes
/data            → SQLite DB file (persisted via volume)
railway.json     → Railway deployment config
```

## Run Locally

```bash
npm install
npm start
```

Dev mode (auto-reload):
```bash
npm run dev
```

- Employee booking: http://localhost:3000
- Secretary dashboard: http://localhost:3000/secretary

## Docker

```bash
docker-compose up --build
```

Data persists in `./data/bookings.db` via the Docker volume.

---

## Deploy to Railway

### 1 — Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USER/YOUR_REPO.git
git push -u origin main
```

### 2 — Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Click **Deploy from GitHub repo** → select your repository
3. Railway detects the `Dockerfile` automatically and starts building

### 3 — Add a Volume (SQLite persistence)

Without a volume the DB resets on every redeploy. Add one:

1. In Railway dashboard → your service → **Settings** tab
2. Scroll to **Volumes** → **Add Volume**
3. Mount path: `/app/data`
4. Click **Add** — Railway redeploys automatically

### 4 — Done

Railway injects `PORT` automatically (already handled in `server/index.js`).  
Your app URL appears in the Railway dashboard (e.g. `https://ets-booking-xxx.up.railway.app`).

> **Note:** The free Railway plan has ~500 compute hours/month. For a small internal tool this is usually enough. If you need more, upgrade to the Hobby plan ($5/mo).

---

## Real-time

The secretary dashboard connects to `GET /api/events` (Server-Sent Events).  
Every time a booking is **created** or **deleted**, the server pushes a `booking-changed` event.  
The dashboard reloads data instantly — no polling, no page refresh needed.

If the connection drops (network issue, server restart), the client automatically reconnects after 5 seconds.

---

## Rooms

| Room | Floor     | Capacity | Description                                   |
|------|-----------|----------|-----------------------------------------------|
| A    | 1st floor | 8        | Smart screen, video conferencing, round table |
| B    | 2nd floor | 16       | Projector, HDMI, large presentations          |
| C    | 3rd floor | 6        | Quiet, private discussions, view              |

## API

| Method | Path                | Description                       |
|--------|---------------------|-----------------------------------|
| GET    | /api/bookings       | Bookings by room + date           |
| GET    | /api/bookings/all   | All bookings                      |
| GET    | /api/bookings/:id   | Single booking                    |
| POST   | /api/bookings       | Create booking                    |
| DELETE | /api/bookings/:id   | Delete booking                    |
| GET    | /api/events         | SSE stream (real-time)            |
