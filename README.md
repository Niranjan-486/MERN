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

# Seed initial organization, service, counter, staff, and patients
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

The database seed (`npm run seed`) creates 1 organization ("City General Hospital"), 1 service ("General OPD"), 1 counter ("Counter 1"), 5 patients, and 1 staff user:

| Role | Name | Phone | OTP Code | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Staff** | Staff Member | `9999900000` | `staffsecret123` | Counter staff (`STAFF_OTP_CODE`) |
| **Patient 1** | Patient 1 | `9999900001` | `123456` | Pre-registered patient (`OTP_CODE`) |
| **Patient 2** | Patient 2 | `9999900002` | `123456` | Pre-registered patient (`OTP_CODE`) |
| **Patient 3** | Patient 3 | `9999900003` | `123456` | Pre-registered patient (`OTP_CODE`) |
| **Patient 4** | Patient 4 | `9999900004` | `123456` | Pre-registered patient (`OTP_CODE`) |
| **Patient 5** | Patient 5 | `9999900005` | `123456` | Pre-registered patient (`OTP_CODE`) |
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
   - Desk dashboard opens directly for **"Counter 1"** (the counter picker is automatically skipped when exactly one non-offline counter exists).
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

The initial organization ("City General Hospital"), service ("General OPD"), counter ("Counter 1"), 5 patients, and staff account must be seeded into Atlas.

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

---

## Notifications (Web Push, In-App & Log Channels)

SmartQueue features a decoupled, multi-channel notification pipeline. While in-app toasts and live updates work through Socket.io when the web application is open, Web Push notifications (VAPID) alert patients on their mobile devices and desktops even when the browser or tab is completely closed.

### 1. Delivery Channels

| Channel | Identifier | Destination | Purpose |
| :--- | :--- | :--- | :--- |
| **In-App** | `inapp` | MongoDB `Notification` collection + Socket.io room `user:{userId}` | Live updates, bell menu, and toast alerts for users with the page open. |
| **Web Push** | `push` | Browser Push Service (Apple APNs, Google FCM, Mozilla Autopush) via RFC 8291/8292 | Native notification tray & lock screen alerts when the page/browser is closed. |
| **Audit Log** | `log` | Stdout JSON log (`[NOTIFICATION_LOG]`) | Operational logging and automated verification testing. |

Channels are configured via the `NOTIFY_CHANNELS` environment variable (e.g. `NOTIFY_CHANNELS=inapp,push,log`).

### 2. Generating & Rotating VAPID Keys

Web Push relies on standard VAPID (Voluntary Application Server Identification) keypairs:

```bash
# Generate a fresh VAPID keypair
npm run vapid
```

This outputs ready-to-copy `.env` lines:
```env
VAPID_PUBLIC_KEY=BNcRdre... (87 characters base64url)
VAPID_PRIVATE_KEY=tBHItJI... (43 characters base64url)
VAPID_SUBJECT=mailto:admin@example.com
```

#### Automated Client Key Rotation
If you ever rotate the VAPID keys on the server:
- When a user opens the application, `usePushNotifications` checks the server's public key from `GET /api/push/public-key`.
- If the browser's existing subscription key differs from the new public key, the client automatically unsubscribes the old key, removes the obsolete endpoint on the server, and registers a fresh subscription with the new key. No user intervention is required.

### 3. Testing Web Push Locally

#### Desktop Chrome / Edge:
1. Ensure `NOTIFY_CHANNELS=inapp,push,log` in `server/.env`.
2. Ensure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` are set in `server/.env`.
3. Start the server (`npm run dev`) and client (`npm run dev:client`).
4. Log in as a patient at `http://localhost:5173/login`.
5. On the patient home screen, locate the **"Get notified even when this page is closed"** card.
6. Click **"Enable notifications"** and choose **"Allow"** in the browser permission prompt.
7. Click the **"Test push"** button.
8. Observe the native OS notification alert on your desktop.
9. Close the browser tab. In another window or terminal, call the patient's token — the push notification will still appear!

#### Android (Chrome / Edge / Firefox):
1. Connect to the client using your machine's LAN IP or an HTTPS tunnel (e.g., ngrok/Render).
2. Tap "Enable notifications" -> "Allow".
3. Notifications will arrive in the Android system tray and vibrate the device.

#### iOS Safari (iPhone / iPad):
- **Apple Requirement**: Web Push on iOS requires iOS 16.4+ and requires the site to be installed as a PWA on the Home Screen.
- If opened directly in Safari, SmartQueue displays an **"Add to Home Screen"** badge with instructions: tap the **Share** button (box with upward arrow) -> tap **"Add to Home Screen"**.
- Once launched from the Home Screen icon, tap **"Enable notifications"** to receive lock-screen push alerts.

### 4. Privacy & Payload Security Contract
- **No Personal Health Data (PHI)**: Push payloads never include patient names, phone numbers, or clinical details.
- **Payload Structure**: Payloads strictly contain `{ title, body, kind, tag, url, requireInteraction }` (always under 1 KB).
- **Rationale**: Prevents data leakage on shared lock screens, ambient family displays, and intermediate third-party push relay clouds.

### 5. Common Troubleshooting
- **Notification permission blocked**: If a user previously clicked "Block", the browser does not allow re-prompting via JavaScript. The user must click the site settings / padlock icon in the URL bar and change Notifications to "Allow".
- **Localhost HTTP vs HTTPS**: Service Workers and Push API work on `http://localhost` (secure origin exception) and any `https://` domain. On remote LAN IPs (e.g. `http://192.168.1.5:5173`), modern browsers require HTTPS.
- **Shared phones**: When User B logs in on a phone previously used by User A, the atomic upsert on `/api/push/subscriptions` automatically reassigns the device endpoint to User B and cleans up subscriptions older than the newest 5 devices.

---

## Demo & Simulator Tools

SmartQueue includes built-in operational tools for hackathon demonstrations, load simulation, and automated benchmark verification.

### 1. QR Code Generator (`npm run qr`)
Generates standalone SVG QR codes for slides, queue banners, and posters.
```bash
# Generate SVG QR poster for a service join URL
npm run qr -- http://localhost:5173/join/service-id ./poster.svg
```
*(Also accessible from the Staff Dashboard via the **"Show QR"** button with a print-optimized stylesheet).*

### 2. Database Preparation & Cleanup (`npm run sim:db`)
Prepares ETA calculation baselines and cleans up simulated records after demos.
```bash
# Prepare: Sets service avgServiceTimeSec to baseline (default 180s) and serviceSamples to 5
npm run sim:db -- prepare --avg 180

# Cleanup: Deletes all simulated patients (^00000), tokens, notifications, and push subscriptions;
# resets avgServiceTimeSec to default 300s. Pass --reset-numbering to clear today's sequence counter.
npm run sim:db -- cleanup --reset-numbering
```

#### Safety Rules:
- Prints target database host and database name before modifying any data.
- Refuses to run against non-localhost databases without the explicit `--yes` flag.
- `--reset-numbering` will **refuse** if any non-simulated (real patient) tokens were issued today, protecting real records.

### 3. Patient Simulator (`npm run sim`)
Simulates realistic hospital arrivals or high-concurrency burst workloads.

#### Configuration (Environment Variables & Flags):
- `STAFF_PHONE` (default: `9999900000`)
- `STAFF_CODE` (default: `staffsecret123`)
- `PATIENT_CODE` (default: `123456`)
- `SIMULATOR_KEY` (optional 24+ char key; bypasses auth rate limiter via `x-simulator-key` header)
- `--api <url>`: Target backend server (default: `http://localhost:3000`). Target host must be localhost, or `--yes` must be passed.

#### Demo Mode (`npm run sim -- demo`)
Simulates a live OPD environment with arriving patients, random cancellations, staff emergency priority joins, and optional staff bot:
```bash
npm run sim -- demo --patients 40 --duration 90 --cancel-rate 0.05 --priority-rate 0.1
```
- `--patients`: Total patients arriving (default: 40).
- `--duration`: Total simulation duration in seconds (default: 90s).
- `--cancel-rate`: Fraction of waiting patients who cancel (default: 0.05).
- `--priority-rate`: Fraction of patients joined with emergency priority 1/2 by staff (default: 0.1).
- `--staff-bot`: Optional automated bot working the counter (calls next, serves 10-20s, completes).
- `--no-show-rate`: Fraction of called tokens left untouched so the no-show grace timer fires (default: 0.05).
- Displays a clean, real-time single-line status updated once per second:
  `[Demo] 00:32 / 01:30 | Arrived: 15/40 | Priority: 2 | Cancelled: 1 | Served: 5 | No-shows: 0`

#### Burst Mode (`npm run sim -- burst`)
Simultaneously joins N patients to benchmark latency, sequence integrity, and WebSocket convergence:
```bash
npm run sim -- burst --patients 20
```
- Pre-connects all patient WebSockets via `websocket` transport.
- Fires simultaneous join requests with `Promise.all`.
- Measures HTTP join latencies (p50, p90, p95, p99, min, max, avg).
- Formally asserts token numbers are strictly contiguous (1..N) with zero duplicates.
- Measures realtime convergence time until all connected sockets receive `token:updated` reflecting true `peopleAhead`.
- Clean shutdown on `Ctrl+C` (disconnects all sockets).

---

## Benchmarks & Performance Verification

SmartQueue includes a headless automated benchmark harness (`bench/`) designed to evaluate throughput, concurrency limits, real-time event coalescing, and recovery resilience under high load.

### 1. Benchmark Environment

All measurements below were captured locally on bare metal:

| Parameter | Host Specification |
| :--- | :--- |
| **CPU Model** | 13th Gen Intel(R) Core(TM) i5-1334U (12 cores) |
| **Total Memory** | 15.72 GB RAM |
| **Operating System** | Windows_NT 10.0.26200 (x64) |
| **Runtime** | Node.js v20.19.6 |
| **Git Commit** | `4ba0204` |
| **Databases** | MongoDB 7.0.43 (WiredTiger), Redis 7.4.11 |
| **Network** | Loopback (`127.0.0.1`), WebSocket transport, Keep-Alive HTTP |

---

### 2. Methodology & Workload Scenarios

The harness executes three distinct workload scenarios against an isolated benchmark database (`smartqueue_bench`):

1. **Burst Concurrency (`burst`)**:
   - $N \in [100, 250, 500]$ patients authenticate, establish active WebSockets, and join the queue simultaneously via REST.
   - Measures: HTTP join latencies (p50/p90/p95/p99/min/max/throughput req/s), strict contiguity, zero duplicate tokens, convergence time (time until all sockets observe their expected position), and event coalescing ratio (`queue:updated` events per socket vs. $N$).
2. **Accelerated Flow (`flow`)**:
   - 300 patients join the queue. An automated staff bot serves them through the full lifecycle (`call-next` $\rightarrow$ `start` $\rightarrow$ `complete`) with accelerated serving times (100–300 ms).
   - Measures: `call-next`-to-`called` event propagation latency (staff action to patient socket update), notification delivery latency, queue drain rate (patients/min), and asserts zero stuck tokens.
3. **Reconnect Storm (`reconnect`)**:
   - 200 connected and waiting patients experience an abrupt simultaneous socket disconnection (simulating a network partition or proxy restart).
   - All 200 sockets reconnect concurrently and refetch their queue state via REST.
   - Measures: Storm duration, recovery latency, and asserts that 100% of sockets reconnect with zero stranded tokens and 0 position mismatches.
4. **Internal Resource Profiling**:
   - Poller queries `GET /internal/metrics` (protected by `SIMULATOR_KEY`) every 1 second, capturing RSS memory, heap usage, CPU user/system times, event loop delay via `perf_hooks.monitorEventLoopDelay({ resolution: 20 })`, and BullMQ job queue counts.

---

### 3. Measured Results (Full Benchmark Suite)

Captured from an actual complete execution run (`npm run bench`):

| Scenario | N | Throughput / Drain Rate | Latency p50 | Latency p95 | Latency p99 | Peak RSS | Event Loop Delay p99 | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **burst** | 100 | 128.87 req/s | 658.5 ms | 732.0 ms | 759.0 ms | 114.29 MB | 119.8 ms | ✅ PASS |
| **burst** | 250 | 164.26 req/s | 1267.0 ms | 1445.4 ms | 1462.0 ms | 164.16 MB | 168.95 ms | ✅ PASS |
| **burst** | 500 | 173.85 req/s | 2557.5 ms | 2740.0 ms | 2748.12 ms | 186.32 MB | 204.6 ms | ✅ PASS |
| **flow** | 300 | 171.48 /min | 69.0 ms | 115.15 ms | 174.04 ms | 261.28 MB | 130.55 ms | ✅ PASS |
| **reconnect** | 200 | 59.1 /s | 2537.5 ms | 3315.45 ms | 3366.12 ms | 384.54 MB | 434.63 ms | ✅ PASS |

#### Burst Scenario Variance (3 Successive Runs):
To measure consistency under concurrency, the burst scenario was repeated across 3 independent runs:

| Concurrency (N) | Run 1 Throughput | Run 2 Throughput | Run 3 Throughput | Mean Throughput | Variance ($\pm$) | Duplicates Detected | Contiguity Gaps |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **N = 100** | 142.65 req/s | 128.87 req/s | 129.37 req/s | **133.63 req/s** | $\pm 6.4\%$ | **0** | **0 (Strict)** |
| **N = 250** | 150.97 req/s | 164.26 req/s | 172.53 req/s | **162.59 req/s** | $\pm 6.6\%$ | **0** | **0 (Strict)** |
| **N = 500** | 154.18 req/s | 173.85 req/s | 200.00 req/s | **176.01 req/s** | $\pm 13.0\%$ | **0** | **0 (Strict)** |

---

### 4. Bottlenecks & Architectural Observations

Real-world load reveals key system behaviors and theoretical limits:

1. **Single-Flight Coalescing Efficiency ($O(N^2)$ Prevention)**:
   - Without event batching, 500 simultaneous joins would trigger $500 \times 500 = 250,000$ socket emissions, crashing the event loop.
   - The single-flight batching engine coalesced these updates into an average of **2.1 to 2.6 events per socket** (a **>99.4% reduction** in outbound network traffic), allowing convergence in under 3.0 seconds.
2. **MongoDB Sequence Lock Serialization**:
   - `TokenSequence.findOneAndUpdate` uses an atomic `$inc` on a single document per service day. This guarantees 100% strict contiguity and zero duplicates, but serializes concurrent writes on that document.
   - As $N$ scaled from 100 to 500, average join latency rose linearly from 561 ms to 2,545 ms due to lock queue wait times, matching theoretical expectations for single-document serialization.
3. **Event Loop Saturation Under High Connection Density**:
   - During the 500-client burst and the 200-socket reconnect storm, Node's event loop delay (p99) climbed from a baseline of ~30 ms to 204 ms (burst) and 434 ms (reconnect storm). Memory RSS peaked at 384 MB during the reconnect storm.
4. **Client-Side Socket Pooling**:
   - High concurrent `fetch` requests and WebSocket handshakes from a single benchmark host require adequate connection pool sizing (`maxPoolSize=300`) and retry handling to prevent local OS TCP ephemeral port exhaustion.

---

### 5. Running the Benchmarks Locally

#### Headless Benchmark Harness:
```bash
# Run all benchmark scenarios (burst 100, 250, 500, flow 300, reconnect 200)
npm run bench

# Run a specific scenario with custom concurrency
npm run bench -- --scenarios burst --concurrency 100

# Output Markdown table ready for documentation
npm run bench:table
```

#### HTTP API Load Test with k6 (`bench/k6-http.js`):
Covering the core loop (Verify OTP $\rightarrow$ List Services $\rightarrow$ Join Queue $\rightarrow$ Poll Token Status) with a ramping arrival rate executor:

```bash
# Run with local k6 installation
k6 run -e TARGET_URL=http://localhost:10000 -e SIMULATOR_KEY=smartqueue-bench-simulator-key-2026-safe bench/k6-http.js

# Or run with Docker (zero local installation required)
docker run --rm -i --net="host" \
  -e TARGET_URL=http://localhost:10000 \
  -e SIMULATOR_KEY=smartqueue-bench-simulator-key-2026-safe \
  grafana/k6 run - < bench/k6-http.js
```



