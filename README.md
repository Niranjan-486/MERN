# SmartQueue

Real-time queue management system for hospital outpatient departments (OPDs) and public service offices.

Engineered with:
- **Backend (Node.js 20+ & Express)**: Atomic MongoDB concurrency guarantees, strict partial unique indexes, zero read-then-write races, decoupled domain events, and role-based JWT authentication.
- **Real-Time Layer (Socket.io)**: Authenticated WebSockets with server-managed rooms (`user:{userId}`, `service:{serviceId}`) and a single-flight coalescing engine to prevent broadcast storms.
- **Frontend (Vite + React 18, Plain CSS)**: Mobile-first responsive UI for patients, desktop operations dashboard for counter staff, resilient client-side coalesced auto-refreshing, and full ARIA accessibility.

---

## Documentation
- [SPEC.md](SPEC.md): Source of truth for domain models, indexes, state machine, auth rules, read endpoints, and real-time event contracts.
- [server/README.md](server/README.md): Backend installation, database architecture, concurrency proofs, and curl API walkthrough.
- [client/README.md](client/README.md): Frontend structure, components, state management, and test suite.

---

## Quick Start (Running Server and Client Together)

### 1. Prerequisites
- Node.js 20+
- Docker & Docker Compose

### 2. Start Containers & Seed Database
```bash
# Start MongoDB (port 27017) and Redis (port 6379)
docker compose up -d

# Install backend & frontend dependencies
cd server && npm install && cd ../client && npm install && cd ..

# Setup environment files
cp server/.env.example server/.env
cp client/.env.example client/.env

# Seed initial organization, services, counters, staff, and patients
npm run seed
```

### 3. Run All Automated Tests
Run both server (Jest) and client (Vitest) test suites with one command:
```bash
npm test
```
*(Or run separately: `npm run test:server` and `npm run test:client`).*

### 4. Run Server and Client in Development
Open two terminal windows:

**Terminal 1 — Backend Server (runs on http://localhost:3000):**
```bash
npm run dev
```

**Terminal 2 — Frontend Client (runs on http://localhost:5173):**
```bash
npm run dev:client
```

---

## Seed Accounts & Test Credentials

The database seed (`npm run seed`) creates an organization ("City General Hospital"), an active service ("General OPD"), three counters, and the following login accounts:

| Role | Name | Phone | OTP Code | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Staff** | Dr. Sharma (Staff) | `9999900000` | `staffsecret123` | Counter staff (`STAFF_OTP_CODE`) |
| **Patient 1** | Ramesh Kumar | `9999900001` | `123456` | Pre-registered patient (`OTP_CODE`) |
| **Patient 2** | Priya Sharma | `9999900002` | `123456` | Pre-registered patient (`OTP_CODE`) |
| **Patient 3** | Amit Patel | `9999900003` | `123456` | Pre-registered patient (`OTP_CODE`) |
| **New Patient** | *(any 10-13 digit phone)* | e.g. `9876543210` | `123456` | Auto-registers as `Patient <digits>` |

---

## Step-by-Step Manual End-to-End Verification

Follow this walkthrough to test the real-time queue synchronization across two browser tabs:

### Step 1: Open Patient Screen
1. Open a browser window to `http://localhost:5173/login`.
2. Enter phone: `9999900001` -> Click **"Request Code"**.
3. In the Code field, enter `123456` -> Click **"Sign In"**.
4. You are redirected to `/patient`. Observe:
   - Green connection badge: **"Live"**.
   - Available OPD Services list displays **"General OPD"** with its current waiting count.
5. Click **"Join queue"** on General OPD.
6. **Instant result**: The Token Card renders immediately:
   - Big token number (e.g. `#1`).
   - Status badge: `WAITING`.
   - Live status text: `"People ahead of you: 0"`.
   - Visible button: `"Cancel Token"`.

### Step 2: Open Staff Dashboard
1. Open a second browser window (e.g., incognito or separate window) to `http://localhost:5173/login`.
2. Enter phone: `9999900000` -> Click **"Request Code"**.
3. In the Code field, enter `staffsecret123` -> Click **"Sign In"**.
4. You are redirected to `/staff`. Observe:
   - Counter picker defaults to **"Counter 1 (General OPD)"**.
   - **Total Waiting: 1**.
   - Waiting list displays patient `#1 Ramesh Kumar`.
   - Prominent **"Call Next"** button is enabled.

### Step 3: Staff Calls Next Patient
1. On the Staff window, click **"Call Next"**.
2. **Observe Window 1 (Patient)** in real time without refreshing:
   - Token card status changes to `CALLED`.
   - Prominent banner pulses: **"Your turn! Please go to Counter 1"**.
   - Browser tab title changes to **"Your turn!"**.
   - Haptic vibration triggers if supported on mobile devices (`navigator.vibrate(200)`).
3. **Observe Window 2 (Staff)**:
   - Current Patient panel shows `#1 Ramesh Kumar (CALLED)`.
   - Action buttons appear: **"Start Serving"** and **"Skip"**.
   - "Call Next" is disabled because this counter is currently holding a called patient.

### Step 4: Staff Starts and Completes Consultation
1. On the Staff window, click **"Start Serving"**.
   - Window 1 (Patient) status badge changes to `SERVING` with text: `"Being served at Counter 1"`. Cancel button is automatically removed.
2. On the Staff window, click **"Complete Consultation"**.
   - Window 1 (Patient) status badge changes to `COMPLETED` with text: `"Consultation completed. Thank you!"`, and a `"Join again"` button appears.
   - Window 2 (Staff) returns to idle counter state.

---

## Deploying to Render

This repository includes a Render Blueprint specification (`render.yaml`) that deploys the application as two connected services:
1. **API Web Service (`smartqueue-api-firstmern`)**: Node.js backend running on the Free tier in Singapore.
2. **Client Static Site (`smartqueue-web-firstmern`)**: Vite React frontend hosted on Render's global CDN.

---

### 1. MongoDB Atlas Setup

Render services connect to a managed MongoDB Atlas database:
1. **Create an Atlas Account & Cluster**:
   - Log in to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
   - Create a free M0 cluster (e.g., in the Singapore `ap-southeast-1` region to match Render API service latency).
2. **Create a Database User**:
   - In Atlas, navigate to **Security > Database Access**.
   - Click **Add New Database User**.
   - Choose **Password** authentication, generate a secure password, and grant `readWriteAnyDatabase` or `readWrite` privileges to the `smartqueue` database.
3. **Configure Network Access**:
   - In Atlas, navigate to **Security > Network Access**.
   - Click **Add IP Address**.
   - Select **Allow Access from Anywhere (`0.0.0.0/0`)** because Render free-tier instances have dynamic outbound IP addresses.
4. **Obtain Connection String**:
   - Go to **Database > Deployment > Connect > Drivers (Node.js)**.
   - Copy the SRV connection URI and append the database name `smartqueue` before query parameters:
     ```
     mongodb+srv://<username>:<password>@<cluster-address>.mongodb.net/smartqueue?retryWrites=true&w=majority&appName=SmartQueue
     ```
   - **Crucial**: Ensure `<password>` is URL-encoded if it contains special characters, and verify the database name `/smartqueue` is included in the path.

---

### 2. Push Repository to GitHub

Ensure all changes are committed and pushed to your GitHub repository:
```bash
git add .
git commit -m "Configure production deployment for Render"
git push origin master
```

---

### 3. Create Blueprint on Render

1. Log into your [Render Dashboard](https://dashboard.render.com).
2. Click **New +** and select **Blueprint**.
3. Connect your GitHub repository containing `render.yaml`.
4. Render automatically parses `render.yaml` and displays the two services:
   - `smartqueue-api-firstmern` (Web Service)
   - `smartqueue-web-firstmern` (Static Site)
5. You will be prompted to enter the unsynced confidential environment variables marked `sync: false`:
   - `MONGO_URI`: Paste your full MongoDB Atlas connection string.
   - `STAFF_OTP_CODE`: Set a secret staff OTP (at least 8 characters long, e.g., `staffsecret123`).
6. Click **Apply**. Render will trigger the build and deployment process for both services.

---

### 4. Environment Variables Reference

| Variable | Service | Secret? | Default / Example Value | Description |
| :--- | :--- | :---: | :--- | :--- |
| `NODE_ENV` | API | No | `production` | Sets Node.js environment to production mode. |
| `PORT` | API | No | `10000` (injected by Render) | Port the HTTP and Socket.io server listens on (bound to `0.0.0.0`). |
| `MONGO_URI` / `MONGODB_URI` | API | **Yes** | `mongodb+srv://.../smartqueue` | Atlas connection string. Required for database access. |
| `JWT_SECRET` | API | **Yes** | Generated by Render (`generateValue: true`) | Min 32-character key for signing and verifying JSON Web Tokens. |
| `OTP_CODE` | API | No | `123456` | Public demo OTP code for patients and newly registering phones. |
| `STAFF_OTP_CODE` | API | **Yes** | User-configured (`sync: false`, min 8 chars) | Private OTP code required for staff and admin roles. |
| `CLIENT_ORIGIN` | API | No | `https://smartqueue-web-firstmern.onrender.com` | Comma-separated list of allowed CORS and Socket.io origins (trimmed, trailing slashes stripped). |
| `TIMEZONE` | API | No | `Asia/Kolkata` | Timezone used to compute the per-day `queueDate` (`YYYY-MM-DD`). |
| `VITE_API_URL` | Client | No | `https://smartqueue-api-firstmern.onrender.com` | URL of the backend API used for REST requests and Socket.io connections. Build fails if omitted. |
| `VITE_DEMO_HINT` | Client | No | `123456` | Optional demo OTP hint shown on the client login screen. |

---

### 5. Seeding Production Database

The initial organization ("City General Hospital"), services ("General OPD"), counters, and staff account must be seeded into Atlas.

Because remote databases require safety confirmation, `npm run seed` requires the `--yes` flag when connecting to a non-localhost host:

```bash
# Set your production Atlas connection string locally:
export MONGO_URI="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/smartqueue?retryWrites=true&w=majority"
export STAFF_OTP_CODE="staffsecret123"
export OTP_CODE="123456"
export CLIENT_ORIGIN="https://smartqueue-web-firstmern.onrender.com"

# Run the idempotent seed with --yes
npm run seed -- --yes
```
The script will display the host and database name before safely performing idempotent upserts.

---

### 6. Running Smoke Test

Once deployed, run the automated end-to-end smoke test against the live Render API:

```bash
# Syntax: npm run smoke -- <apiUrl>
npm run smoke -- https://smartqueue-api-firstmern.onrender.com
```

Optionally set custom staff credentials in your environment if changed on Render:
```bash
STAFF_PHONE=9999900000 STAFF_CODE=staffsecret123 npm run smoke -- https://smartqueue-api-firstmern.onrender.com
```

The smoke test validates:
1. Retries `GET /health` every 5 seconds for up to 90 seconds (surviving Render cold-starts).
2. Verifies `GET /ready` returns active MongoDB connectivity.
3. Logs in a temporary throwaway patient (`Smoke Test`) and the staff member.
4. Checks waiting count: safely skips staff operations if the queue has waiting patients to prevent affecting real users.
5. Patient joins queue, connects via Socket.io client, and listens for `token:updated` events.
6. Staff calls next, starts consultation, and completes consultation.
7. Asserts the patient socket receives `called`, `serving`, and `completed` events within 15 seconds.
8. Cleans up any incomplete token on failure.

---

### 7. Troubleshooting

- **Port Binding**:
  Render assigns a dynamic port via `process.env.PORT` (usually `10000`). The server must listen on `process.env.PORT || 10000` and bind to host `0.0.0.0` (not `localhost` or `127.0.0.1`). Binds to `localhost` will cause Render port detection to time out.
- **Health Check Failing**:
  Render zero-downtime deploy monitors `GET /health`. This endpoint is deliberately shallow and unauthenticated with no database queries to respond immediately with `{ status: "ok" }`. Deep database checks are isolated to `GET /ready`.
- **CORS Errors**:
  If requests from the client fail with CORS errors, verify `CLIENT_ORIGIN` matches the client URL exactly (e.g. `https://smartqueue-web-firstmern.onrender.com`). Trailing slashes are stripped and multiple origins can be comma-separated, but ensure the scheme (`https://`) and hostname match.
- **404 on Refresh (SPA Routing)**:
  Directly visiting or refreshing `/patient` or `/staff` results in a 404 error if rewrite rules are missing. `render.yaml` configures a rewrite route from `/*` to `/index.html`, allowing React Router to handle client-side routing.
- **Vite Environment Changes Require Rebuild**:
  Static sites cannot read server-side environment variables at runtime. Vite injects `VITE_API_URL` into JavaScript assets during `npm run build`. If you change `VITE_API_URL` or `VITE_DEMO_HINT`, you must trigger a manual deploy / rebuild of the static site.
- **Free Tier Cold Starts (15 Minutes Idle)**:
  On Render's Free tier, services spin down after 15 minutes of inactivity. The initial incoming HTTP request wakes the instance, which can take 50–90 seconds. The smoke test and client retry handling account for this delay.

---

## ETA and Job Design

### 1. Wait-Time Estimates (ETA) & Service EWMA Tracking

#### Pure ETA Simulation (`computeEtas`)
The waiting time estimation is calculated via a pure, deterministic simulation in `server/src/services/etaService.js`:
- **Counter Availability Simulation**:
  - Only counters with `status: 'active'` are considered. Paused or offline counters are ignored. If no active counters exist, every waiting token receives `etaSeconds: null`.
  - For each active counter, its initial `busyUntil` is simulated:
    - If idle: `busyUntil = now`.
    - If holding a `called` token: `busyUntil = now + avgServiceSec`.
    - If holding a `serving` token: `busyUntil = now + max(30, avgServiceSec - secondsAlreadyServing)`.
- **Greedy Earliest-Available Counter Allocation**:
  - Waiting tokens are evaluated in exact call order (priority desc, then token number asc).
  - For each waiting token, the algorithm selects the counter that frees up earliest (`earliestTime`).
  - `etaSeconds = max(0, round((earliestTime - now) / 1000))`.
  - The assigned counter's availability is then advanced: `counter.busyUntil = earliestTime + avgServiceSec`.
- **Properties**:
  - ETAs never decrease along the waiting list.
  - Snapshot ETAs (`getQueueSnapshot`) and individual token status lookups (`getTokenStatus`) call the same pure function, guaranteeing agreement.

#### Service-Time EWMA Tracking
When a token transitions `serving -> completed`, `Service.avgServiceTimeSec` and `serviceSamples` are updated in a single atomic MongoDB aggregation-pipeline update:
- `sample = completedAt - servingAt` in seconds.
- Samples under 10 seconds are completely ignored.
- Samples are capped at `3 * currentAvg` to protect the average against forgotten "Complete" button clicks.
- Fast warm-up weight formula: `weight = max(0.2, 1 / (serviceSamples + 2))`.
- Moving average: `avg = round(avg * (1 - weight) + sample * weight)`.
- Increments `serviceSamples` by 1 atomically without read-then-write races.

---

### 2. Jobs Subsystem (BullMQ + Redis)

#### Table of Jobs

| Job Name | Queue | Trigger | Deterministic Job ID | Idempotency Key / Check | Retry Policy | Failure Mode & Recovery |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `noshow` | `timers` | Staff calls token (`callNext`) | `noshow-<tokenId>` | Filter `{ _id, status: 'called', calledAt: { $lte: cutoff } }` | No retry needed (delay = grace period) | If Redis wiped/crashes, background 30s `sweeper` finds overdue called tokens directly in MongoDB and executes `markNoShow`. |
| `notify` (`near`) | `notify` | Token join, call-next, no-show, cancel, or 30s sweeper | `notify-<tokenId>-near` | Mongo unique index on `Notification (tokenId, kind)` + existence check | 4 attempts, exponential backoff from 2s | `Notification` document tracks `deliveredChannels` with `$addToSet`; channels never double-send. Sweeper triggers near-planner if Redis lost work. |
| `notify` (`called`) | `notify` | Staff calls token (`callNext`) | `notify-<tokenId>-called` | Mongo unique index on `Notification (tokenId, kind)` | 4 attempts, exponential backoff from 2s | Same multi-channel tracking; idempotent claim. |
| `notify` (`no_show`)| `notify` | Token marked as no-show | `notify-<tokenId>-no_show` | Mongo unique index on `Notification (tokenId, kind)` | 4 attempts, exponential backoff from 2s | Same multi-channel tracking; idempotent claim. |

#### Environment Variables

| Variable | Default | Purpose / Behavior |
| :--- | :--- | :--- |
| `REDIS_URL` | `redis://localhost:6379` | Connection URL for Redis / Key-Value service. |
| `JOBS_ENABLED` | `true` | Enables BullMQ queues and workers (defaults to `false` in Jest unless opted in). |
| `NO_SHOW_GRACE_SECONDS` | `180` | Number of seconds a called patient has to arrive before being marked `no_show`. |
| `NEAR_THRESHOLD` | `3` | Patients with `peopleAhead <= NEAR_THRESHOLD` receive "your turn is near" alerts. |
| `NOTIFY_CHANNELS` | `inapp,log` | Comma-separated active notification channels (`inapp` for WebSockets, `log` for structured console logs). |

#### Redis Outage Resilience & Self-Healing
1. **Producer Resilience**: Queue producers use `enableOfflineQueue: false` so API requests fail fast and never hang if Redis is offline. Enqueue calls are fire-and-forget inside `try/catch`.
2. **Startup Grace**: `startJobs()` pings Redis first. If unreachable, it logs ONE warning, leaves the HTTP server running, and retries in the background (15s backing off to 60s), initializing queues and workers once Redis connects.
3. **Sweeper Healing**: A background sweeper runs every 30 seconds:
   - Scans MongoDB for `status: 'called'` with `calledAt <= now - grace` and invokes `markNoShow` directly. This requires **zero Redis**.
   - If Redis wipes its memory or restarts, the sweeper heals overdue tokens and re-dispatches near notifications automatically.

---

### 3. Local Redis & Watching an Auto No-Show

#### Running Redis Locally
Start Redis with the required `noeviction` memory policy via Docker Compose:
```bash
docker compose up -d redis
```

#### Watching an Auto No-Show in Real Time (with 20s Grace Period)
Follow these exact steps to see automatic no-show and local notifications in action:

##### Step 1: Start the API server with a 20-second grace period
- **In PowerShell (Windows)**:
  ```powershell
  $env:NO_SHOW_GRACE_SECONDS="20"; npm run dev
  ```
- **In Bash (macOS / Linux)**:
  ```bash
  NO_SHOW_GRACE_SECONDS=20 npm run dev
  ```

##### Step 2: In a second terminal, open the CLI watch tool for Patient 1
- **In PowerShell (Windows)**:
  ```powershell
  $PATIENT_JWT = (Invoke-RestMethod -Uri "http://localhost:3000/api/auth/verify-otp" -Method Post -ContentType "application/json" -Body '{"phone":"9999900001","otp":"123456"}').token
  npm run watch -- $PATIENT_JWT
  ```
- **In Bash (macOS / Linux)**:
  ```bash
  PATIENT_JWT=$(node -e "
    const http = require('http');
    const req = http.request('http://localhost:3000/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => console.log(JSON.parse(data).token));
    });
    req.write(JSON.stringify({ phone: '9999900001', otp: '123456' }));
    req.end();
  ")

  npm run watch -- $PATIENT_JWT
  ```

##### Step 3: In a third terminal, have Staff call the next token
- **In PowerShell (Windows)**:
  ```powershell
  $STAFF_JWT = (Invoke-RestMethod -Uri "http://localhost:3000/api/auth/verify-otp" -Method Post -ContentType "application/json" -Body '{"phone":"9999900000","otp":"staffsecret123"}').token
  $COUNTERS = Invoke-RestMethod -Uri "http://localhost:3000/api/counters" -Headers @{ Authorization = "Bearer $STAFF_JWT" }
  $COUNTER_ID = $COUNTERS[0].id
  Invoke-RestMethod -Uri "http://localhost:3000/api/counters/$COUNTER_ID/call-next" -Method Post -Headers @{ Authorization = "Bearer $STAFF_JWT" }
  ```
- **In Bash (macOS / Linux)**:
  ```bash
  STAFF_JWT=$(node -e "
    const http = require('http');
    const req = http.request('http://localhost:3000/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => console.log(JSON.parse(data).token));
    });
    req.write(JSON.stringify({ phone: '9999900000', otp: 'staffsecret123' }));
    req.end();
  ")

  COUNTER_ID=$(node -e "
    const http = require('http');
    const req = http.request('http://localhost:3000/api/counters', {
      headers: { 'Authorization': 'Bearer ' + process.argv[1] }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => console.log(JSON.parse(data)[0].id));
    });
    req.end();
  " "$STAFF_JWT")

  curl -X POST "http://localhost:3000/api/counters/$COUNTER_ID/call-next" \
    -H "Authorization: Bearer $STAFF_JWT"
  ```

##### Step 4: Observe the watch terminal
- Immediate event: `notification:new` with `kind: "called"` and `token:updated` (`status: "called"`).
- After exactly 20 seconds of inactivity:
  - Worker triggers `markNoShow`.
  - Event received: `token:updated` with `status: "no_show"`.
  - Event received: `notification:new` with `kind: "no_show"`.
  - The counter is immediately freed to call the next patient.

