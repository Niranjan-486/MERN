# SmartQueue

Real-time queue management system for hospital outpatient departments (OPDs) and public service offices.

Engineered with:
- **Node.js 20+ & Express**
- **MongoDB & Mongoose**: Single-operation atomic state transitions, strict compound unique indexes, and no read-then-write race conditions
- **Socket.io**: Authenticated real-time synchronization with server-managed rooms and single-flight coalesced batching
- **JWT & Role-Based Access Control**: Strict multi-tenant organization boundaries and role enforcement

## Documentation
- [SPEC.md](SPEC.md): Source of truth for domain models, indexes, state machine, auth rules, and realtime contract.
- [server/README.md](server/README.md): Detailed installation instructions, architecture deep dive, dependency rationales, curl API walkthrough, and concurrency proof.

## Quick Start

```bash
# 1. Start MongoDB and Redis services
docker compose up -d

# 2. Install dependencies
cd server
npm install
cp .env.example .env

# 3. Seed database
npm run seed

# 4. Run test suite
npm test

# 5. Run development server
npm run dev
```
