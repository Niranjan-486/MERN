# SmartQueue spec

## Entities (Mongoose, all with timestamps)
- Organization: name, type (hospital | government | other)
- Service: organizationId, name, avgServiceTimeSec (default 300), isActive    // e.g. "General OPD"
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

## Rules for queue operations
- Token numbers come from ONE atomic findOneAndUpdate with $inc and upsert on TokenSequence. Never read-then-write. If upsert races throw E11000 on initial creation, retry once.
- "Call next" is ONE atomic findOneAndUpdate (waiting -> called), sorted by priority desc then number asc, so two counters can never take the same token.
- Every status change goes through the state machine, and every update includes the expected current status in its filter.
- Business logic lives in services/, never in routes or socket handlers.
- A queue is per service per day. queueDate uses a configurable timezone (TIMEZONE env var, default Asia/Kolkata).
