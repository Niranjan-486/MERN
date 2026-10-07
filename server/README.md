# SmartQueue — Server

Real-time queue management system backend for OPDs and government offices.

## Prerequisites
- Node.js 20+
- Docker & Docker Compose

## Setup

```bash
# 1. Start Mongo and Redis containers
docker compose up -d

# 2. Install dependencies
cd server
npm install

# 3. Create .env from template
cp .env.example .env

# 4. Seed database (creates Org, Service, 3 Counters, 1 Staff, 5 Patients)
npm run seed

# 5. Run tests (unit + integration concurrency tests)
npm test

# 6. Run in development (auto-restart on changes)
npm run dev
```

## Verify with curl

```bash
# 1. Check health
curl http://localhost:3000/health

# 2. Patient joins queue (using IDs printed by npm run seed)
curl -X POST http://localhost:3000/api/services/<SERVICE_ID>/tokens \
  -H "Content-Type: application/json" \
  -d '{"userId": "<PATIENT_1_ID>", "priority": 0}'

# 3. Check token position & people ahead
curl http://localhost:3000/api/tokens/<TOKEN_ID>

# 4. Counter calls next waiting token
curl -X POST http://localhost:3000/api/counters/<COUNTER_1_ID>/call-next

# 5. Counter starts serving patient
curl -X POST http://localhost:3000/api/tokens/<TOKEN_ID>/start \
  -H "Content-Type: application/json" \
  -d '{"counterId": "<COUNTER_1_ID>"}'

# 6. Counter completes service
curl -X POST http://localhost:3000/api/tokens/<TOKEN_ID>/complete \
  -H "Content-Type: application/json" \
  -d '{"counterId": "<COUNTER_1_ID>"}'

# 7. (Optional) Patient cancels waiting token
curl -X POST http://localhost:3000/api/tokens/<TOKEN_ID>/cancel \
  -H "Content-Type: application/json" \
  -d '{"userId": "<PATIENT_ID>"}'
```

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
