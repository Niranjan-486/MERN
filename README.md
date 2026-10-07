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
