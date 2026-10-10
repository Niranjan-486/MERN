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
