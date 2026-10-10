# SmartQueue — Server

Real-time queue management system backend for hospital OPDs and government offices.
Engineered with atomic MongoDB concurrency guarantees, role-based JWT authentication, and an isolated Socket.io real-time layer with single-flight event coalescing.

---

## Prerequisites
- Node.js 20+
- Docker & Docker Compose

---

## Setup & Running

```bash
# 1. Start MongoDB and Redis containers
docker compose up -d

# 2. Navigate to server directory and install dependencies
cd server
npm install

# 3. Create .env from template
cp .env.example .env

# 4. Seed database (creates Org, Service, 3 Counters, 1 Staff, 5 Patients)
npm run seed

# 5. Run complete test suite (unit + integration concurrency & realtime tests)
npm test

# 6. Start development server (auto-restarts on code changes)
npm run dev
```

---

## Seed Accounts & Test Credentials

The database seed (`npm run seed`) populates a test organization, a General OPD service, three counters, and known user credentials:

| Role | Name | Phone | OTP | Organization |
| :--- | :--- | :--- | :--- | :--- |
| **Staff** | Dr. Sharma (Staff) | `9999900000` | `staffsecret123` | City General Hospital |
| **Patient 1** | Ramesh Kumar | `9999900001` | `123456` | — |
| **Patient 2** | Priya Sharma | `9999900002` | `123456` | — |
| **Patient 3** | Amit Patel | `9999900003` | `123456` | — |
| **Patient 4** | Sunita Devi | `9999900004` | `123456` | — |
| **Patient 5** | Rajesh Singh | `9999900005` | `123456` | — |
| **New Patient** | *(any new phone)* | `9876543210` | `123456` | — |

> **Security Note**: Staff accounts require the private `STAFF_OTP_CODE` (`staffsecret123`), preventing unauthorized elevation using the well-known patient demo code `123456`. Any brand-new phone number is automatically registered as a patient via an atomic `$setOnInsert` upsert.

---

## Dependencies & Rationale

| Dependency | Category | Rationale |
| :--- | :--- | :--- |
| `jsonwebtoken` | Production | Signs and verifies cryptographically secure, stateless Bearer tokens with 12h expiry containing `{ sub, role, organizationId }`, eliminating server-side session stores. |
| `socket.io` | Production | Powers bidirectional real-time communication between server and clients with automatic WebSocket/polling transport fallback and server-managed room isolation. |
| `cors` | Production | Configures Cross-Origin Resource Sharing using `CLIENT_ORIGIN` to allow web and mobile frontends to access the REST and WebSocket APIs securely. |
| `express-rate-limit` | Production | Protects sensitive authentication routes (`/api/auth/*`) from OTP brute-force attacks and credential stuffing (10 req/min per IP; disabled in `test` environment). |
| `socket.io-client` | Dev / Test | Connects real client socket instances during integration tests to rigorously verify JWT handshakes, room isolation, ordering, and event delivery. |
| `supertest` | Dev / Test | Allows fluent HTTP integration testing directly against the Express application instance without requiring manual network port management. |

---

## Authentication & API Walkthrough (via curl)

### 1. Request OTP
*(Works for existing or new phone numbers; never reveals whether the phone exists)*
```bash
curl -X POST http://localhost:3000/api/auth/request-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9999900001"}'
```

### 2. Verify OTP and Obtain JWT
**For Patient (OTP `123456`):**
```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9999900001", "otp": "123456"}'
```
*Response returns `{ token: "...", user: { id: "...", name: "...", role: "patient" } }`.*

**For Staff (OTP `staffsecret123`):**
```bash
curl -X POST http://localhost:3000/api/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone": "9999900000", "otp": "staffsecret123"}'
```
*Save the returned tokens into shell variables:*
```bash
PATIENT_TOKEN="<COPIED_PATIENT_JWT>"
STAFF_TOKEN="<COPIED_STAFF_JWT>"
```

### 3. Check Current Identity
```bash
curl http://localhost:3000/api/me \
  -H "Authorization: Bearer $PATIENT_TOKEN"
```

### 4. Patient Joins Queue
*(Patient's `userId` is automatically taken from the JWT; priority is forced to 0)*
```bash
curl -X POST http://localhost:3000/api/services/<SERVICE_ID>/tokens \
  -H "Authorization: Bearer $PATIENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 5. Check Token Status & People Ahead
```bash
curl http://localhost:3000/api/tokens/<TOKEN_ID> \
  -H "Authorization: Bearer $PATIENT_TOKEN"
```

### 6. Get Patient's Active Tokens (Reconnect REST Endpoint)
```bash
curl http://localhost:3000/api/me/tokens/active \
  -H "Authorization: Bearer $PATIENT_TOKEN"
```

### 7. Staff Calls Next Waiting Patient
*(Staff only; verifies counter belongs to staff's organization)*
```bash
curl -X POST http://localhost:3000/api/counters/<COUNTER_ID>/call-next \
  -H "Authorization: Bearer $STAFF_TOKEN"
```

### 8. View Service Queue Snapshot (Public Reconnect Endpoint)
```bash
curl http://localhost:3000/api/services/<SERVICE_ID>/queue
```

### 9. Staff Starts Serving Patient
```bash
curl -X POST http://localhost:3000/api/tokens/<TOKEN_ID>/start \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"counterId": "<COUNTER_ID>"}'
```

### 10. Staff Completes Service
```bash
curl -X POST http://localhost:3000/api/tokens/<TOKEN_ID>/complete \
  -H "Authorization: Bearer $STAFF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"counterId": "<COUNTER_ID>"}'
```

### 11. Patient Cancels Own Token
*(Owning patient only; userId is derived securely from JWT)*
```bash
curl -X POST http://localhost:3000/api/tokens/<TOKEN_ID>/cancel \
  -H "Authorization: Bearer $PATIENT_TOKEN"
```

---

## Real-Time Layer & CLI Watch Tool

### Real-Time CLI Watch Tool
You can connect directly to the real-time stream using the included CLI watcher script:

```bash
# Connect as Patient or Staff using their JWT
npm run watch -- <JWT_TOKEN>
```
The CLI watcher authenticates over Socket.io, receives initial active room subscriptions, and logs every incoming `token:updated` and `queue:updated` event in real time.

### Real-Time Architecture

1. **Decoupled In-Process Domain Events**:
   - `queueService` has zero knowledge of Socket.io or WebSockets.
   - After a MongoDB write succeeds, `queueService` emits an internal event `tokenChanged: { serviceId, queueDate, tokenId, userId, status }`.
   - If a database operation fails, nothing is emitted.

2. **Server-Enforced Rooms**:
   - Clients never select rooms. Rooms are managed strictly server-side:
     - `user:{userId}`: Joined upon handshake by all sockets of that user. Receives private `token:updated` notifications.
     - `service:{serviceId}`: Joined by staff of the service's organization, and by patients who currently hold an active token for that service today. When a patient joins, the server automatically enrolls their sockets into `service:{serviceId}`.

3. **Event Contract (Full Payloads, Never Deltas)**:
   - `token:updated` (emitted to `user:{userId}`):
     ```json
     {
       "tokenId": "651f...",
       "serviceId": "651f...",
       "number": 12,
       "status": "called",
       "priority": 0,
       "peopleAhead": null,
       "counterName": "Counter 1",
       "etaSeconds": null
     }
     ```
     *(Note: `peopleAhead` is an integer while `waiting`, `null` otherwise. `counterName` is present while `called` or `serving`, `null` otherwise. `etaSeconds` is an integer while `waiting`, `null` otherwise).*
   - `queue:updated` (emitted to `service:{serviceId}`):
     ```json
     {
       "serviceId": "651f...",
       "queueDate": "2026-10-07",
       "waitingCount": 4,
       "nowServing": [
         {
           "counterId": "651f...",
           "counterName": "Counter 1",
           "tokenNumber": 12,
           "status": "called"
         }
       ]
     }
     ```
     *(Never includes personal patient details, protecting patient privacy).*

4. **Single-Flight Coalescing Engine**:
   - Burst operations (e.g. 100 parallel joins) trigger 100 domain events.
   - Without coalescing, this would trigger 100 separate database scans and 100 broadcast packets per connected client.
   - The engine batches incoming token IDs per `(serviceId, queueDate)` into a pending set.
   - Exactly **one** snapshot read cycle runs per queue key at a time. If new events arrive while a run is in flight, a flag marks that a rerun is needed, and exactly **one** subsequent rerun is executed.
   - This coalesces bursts of 100 parallel events into just 2–3 database queries and socket broadcasts.

5. **Reconnection & State Recovery**:
   - When a client reconnects after network loss, it fetches current authoritative state from REST endpoints without replaying missed events:
     - `GET /api/me/tokens/active`: Active tokens for the user today.
     - `GET /api/services/:serviceId/queue`: Public queue snapshot.

---

## Concurrency Guarantees

Every concurrency guarantee is enforced directly at the MongoDB layer using atomic operations and database indexes — never through read-then-write application logic:

### 1. Unique Token Numbers (No duplicates, no gaps)
- **Mechanism**: Atomic `TokenSequence.findOneAndUpdate({ serviceId, queueDate }, { $inc: { seq: 1 } }, { upsert: true, new: true })`.
- **Index**: Unique compound index on `TokenSequence (serviceId, queueDate)` prevents duplicate sequence counters. Unique compound index on `Token (serviceId, queueDate, number)` prevents duplicate token numbers.
- **Why it works**: MongoDB applies document-level write locks during `$inc`. Sequence numbers are incremented and returned in a single atomic transaction step. If two concurrent requests race to create the first sequence document for the day, the second encounters an `E11000` duplicate key on the unique index and retries once, safely incrementing the newly-created sequence document.

### 2. One Active Token Per User
- **Mechanism**: MongoDB partial unique compound index on `Token (serviceId, queueDate, userId)` with `partialFilterExpression: { isActive: true }`.
- **State Machine**: The token state machine maintains `isActive: true` while a token is in `waiting`, `called`, or `serving`, and transitions it to `isActive: false` upon terminal states (`completed`, `skipped`, `no_show`, `cancelled`).
- **Why it works**: If a user submits multiple join requests concurrently, MongoDB inserts the first document successfully. Concurrent inserts with `isActive: true` trigger an `E11000` duplicate key error on `(serviceId, queueDate, userId)`. The service catches this specific violation by inspecting `err.keyPattern`, fetches the existing active token, and responds with `ALREADY_IN_QUEUE` (HTTP 409). A leftover token from a previous day does not block today's join because `queueDate` is part of the index.

### 3. No Double Call (No token given to two counters)
- **Mechanism**: Atomic `Token.findOneAndUpdate({ serviceId, queueDate, status: 'waiting' }, { $set: { status: 'called', counterId, isHoldingCounter: true, calledAt } }, { sort: { priority: -1, number: 1 }, new: true })`.
- **State Machine**: Calls `assertTransition('waiting', 'called')` before executing the database query.
- **Why it works**: The query filter explicitly requires `status: 'waiting'`. During `findOneAndUpdate`, MongoDB acquires an exclusive write lock on the matched token document. Once the first counter transitions `status` to `'called'`, the filter no longer matches that token for any concurrent counter requests. Subsequent concurrent callers either match the next waiting token or receive `null` (`QUEUE_EMPTY` HTTP 409).

### 4. One Token Per Counter (Counter cannot hold multiple active tokens)
- **Mechanism**: MongoDB partial unique compound index on `Token (counterId, queueDate)` with `partialFilterExpression: { isHoldingCounter: true }`.
- **State Machine**: `isHoldingCounter` is set to `true` when a token transitions to `called` or `serving`, and reset to `false` when the token completes, skips, or cancels.
- **Why it works**: When a counter calls next, the atomic update attempts to set `counterId` and `isHoldingCounter: true`. If the counter already holds another `called` or `serving` token for today's `queueDate`, MongoDB immediately aborts the update with an `E11000` duplicate key violation on `(counterId, queueDate)`. The waiting token remains untouched in `waiting`, and the service translates this index violation to `COUNTER_BUSY` (HTTP 409).

### 5. Cancel vs Call-Next Race
- **Mechanism**: Both operations use atomic `findOneAndUpdate` with the expected status in the filter:
  - `callNext`: filter `{ status: 'waiting' }`
  - `cancelToken`: filter `{ status: { $in: ['waiting', 'called'] }, userId }`
- **Why it works**: Document-level locking serializes the operations:
  - **If callNext executes first**: The token status becomes `'called'` and `counterId` is assigned. The concurrent `cancelToken` matches status `'called'`, legally cancels the token, and resets `isHoldingCounter: false`. The counter is immediately freed, and any subsequent call-next on an empty queue returns `QUEUE_EMPTY`, never `COUNTER_BUSY`.
  - **If cancelToken executes first**: The token status becomes `'cancelled'`. The concurrent `callNext` filter `{ status: 'waiting' }` no longer matches the document, so it advances to the next waiting token or returns `QUEUE_EMPTY`. The cancelled token is never handed to a counter.

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

