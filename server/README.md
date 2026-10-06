# SmartQueue — Server

## Prerequisites
- Node.js 20+
- Docker & Docker Compose

## Setup

```bash
# 1. Start Mongo and Redis
docker compose up -d

# 2. Install dependencies
cd server
npm install

# 3. Create .env from template
cp .env.example .env

# 4. Run in development (auto-restart on changes)
npm run dev

# 5. Run tests
npm test
```

## Verify

```bash
curl http://localhost:3000/health
```
