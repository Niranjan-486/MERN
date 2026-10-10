# SmartQueue spec

## Entities (Mongoose, all with timestamps)
- Organization: name, type (hospital | government | other)
- Service: organizationId, name, avgServiceTimeSec (default 300), serviceSamples (default 0), isActive    // e.g. "General OPD"
- Counter: serviceId, name, status (active | paused | offline), currentTokenId (nullable)    // a physical desk or doctor
- User: phone (unique), name, role (patient | staff | admin), organizationId (for staff/admin)
- Token: serviceId, userId, number, queueDate (YYYY-MM-DD string), status, priority (0 normal, 1 senior citizen, 2 emergency), counterId (nullable), isActive (boolean, true for waiting/called/serving), isHoldingCounter (boolean, true for called/serving), joinedAt, calledAt, servingAt, completedAt
- TokenSequence: serviceId, queueDate, seq    // powers atomic token numbering

## Indexes
- User.phone: unique
- TokenSequence: unique on (serviceId, queueDate)
- Token: unique on (serviceId, queueDate, number)
- Token: partial unique on (serviceId, queueDate, userId), only for active statuses (where isActive is true), so one person cannot hold two active tokens in a service on the same day, while a leftover token from a previous day never blocks today's join.
- Token: partial unique on (counterId, queueDate), only for called/serving statuses (where isHoldingCounter is true), so a counter cannot hold two called/serving tokens on the same day.
- Token: "next in line" index on (serviceId, queueDate, status, priority desc, number asc)

## Token states
waiting -> called | cancelled
called -> serving | skipped | no_show | cancelled
serving -> completed
Terminal: completed, skipped, no_show, cancelled
(skipped = staff skips a called patient; no_show = automatic timeout, added later)

## Queue Rules & Concurrency
- Token numbers come from ONE atomic findOneAndUpdate with $inc and upsert on TokenSequence. Never read-then-write. If upsert races throw E11000 on initial creation, retry once.
- "Call next" is ONE atomic findOneAndUpdate (waiting -> called), sorted by priority desc then number asc, so two counters can never take the same token.
- Every status change goes through the state machine, and every update includes the expected current status in its filter.
- Service-time tracking: on transition serving -> completed, Service.avgServiceTimeSec and serviceSamples are updated in ONE atomic aggregation-pipeline update (capped sample at 3x current avg, samples < 10s ignored, fast warm-up EWMA weight = max(0.2, 1 / (serviceSamples + 2))).
- Business logic lives in services/, never in routes or socket handlers.
- Services never touch sockets: after DB write succeeds, queueService publishes an in-process domain event `tokenChanged`.
- A queue is per service per day. queueDate uses a configurable timezone (TIMEZONE env var, default Asia/Kolkata).

## Authentication & Authorization Rules
- JWT payload: `{ sub: user._id, role, organizationId }`, signed with JWT_SECRET (min 32 chars), expiry 12h.
- Mock OTP verification via `otpService`: patients and brand-new phones verify against `OTP_CODE` (default demo code); staff/admin against confidential `STAFF_OTP_CODE` (min 8 chars).
- Brand-new phone numbers are atomically registered with role `patient` via `$setOnInsert` on the unique `phone` index. If name is omitted, defaults to `Patient <last 4 digits>`. Role is NEVER accepted from the client.
- Auth endpoints (`/api/auth/*`) are rate-limited to 10 requests/min per IP (skipped in test environment).
- Route authorization:
  - `POST /api/services/:serviceId/tokens`: for patients, `userId` is forced to `req.user.id` and `priority` is forced to 0 (cannot self-assign emergency). Staff/admin can specify `{ userId, priority }` for patients, but only for services in their organization.
  - `GET /api/tokens/:tokenId`: accessible only to the owning patient or staff/admin belonging to the service's organization; returns `{ token, peopleAhead, etaSeconds }` (`etaSeconds` is integer while waiting, else null).
  - `POST /api/tokens/:tokenId/cancel`: owning patient only; `userId` taken from verified JWT.
  - `POST /api/counters/:counterId/call-next`, `/start`, `/complete`, `/skip`: staff/admin only, and the counter's service must belong to the user's organization (403 otherwise).
  - `GET /api/services`: any authenticated user; returns active services `[{ id, name, organizationName, waitingCount }]`, with all counts computed in one aggregation.
  - `GET /api/counters`: staff/admin only; returns counters of the user's organization `[{ id, name, status, serviceId, serviceName, current: null | { tokenId, number, status } }]`.
  - `GET /api/counters/:counterId/dashboard`: staff/admin belonging to that counter's organization only (403 otherwise); returns `{ counter, service: { id, name, avgServiceSec }, current, waitingCount, waiting: [{ tokenId, number, priority, patientName, etaSeconds }], nowServing }` (only staff/admin responses may contain patient names; waiting is first 20 in call order).

## Real-time Layer (Socket.io)
- The server decides all rooms; clients never choose or join rooms directly.
- `io.use` verifies the handshake JWT (`socket.handshake.auth.token`).
- Rooms architecture:
  - `user:{userId}`: joined first upon connection.
  - `service:{serviceId}`: joined by patients who have active tokens for today; joined by all sockets of a user upon `tokenChanged` with status `waiting`; joined by staff/admin for all services in their organization.
- Event contract (full current state payloads, never deltas):
  - `token:updated` -> room `user:{userId}`: `{ tokenId, serviceId, number, status, priority, peopleAhead, counterName, etaSeconds }` (`peopleAhead` is integer only while waiting, else `null`; `counterName` is string only while called/serving, else `null`; `etaSeconds` is integer only while waiting, else `null`).
  - `queue:updated` -> room `service:{serviceId}`: `{ serviceId, queueDate, waitingCount, nowServing: [{ counterId, counterName, tokenNumber, status }] }` (no personal patient data).
- Single-flight coalescing per `(serviceId, queueDate)`:
  - Realtime adapter subscribes to `tokenChanged` and batches updates using a pending token set.
  - Only one database read run executes per key at a time. If new events arrive while a run is in flight, exactly one subsequent rerun is executed.
  - Idle keys are cleaned up.
- Reconnect REST sources of truth:
  - `GET /api/me/tokens/active`: active tokens of the authenticated user today, matching `token:updated` format (including `etaSeconds`).
  - `GET /api/services/:serviceId/queue`: public queue state matching `queue:updated` format.
