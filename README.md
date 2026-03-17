# FX Trading App — Backend API

A production-ready NestJS REST API for multi-currency wallet management and FX trading. Users register, verify their email, fund wallets, convert between currencies, and view transaction history — all backed by atomic PostgreSQL transactions and real-time exchange rates.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Setup Instructions](#setup-instructions)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Running Tests](#running-tests)
- [Key Assumptions](#key-assumptions)
- [Architectural Decisions](#architectural-decisions)
- [Scalability Considerations](#scalability-considerations)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        NestJS App                           │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │   Auth   │  │  Wallet  │  │    FX    │  │Transactions│  │
│  │  Module  │  │  Module  │  │  Module  │  │  Module   │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
│       │              │              │               │        │
│  ┌────▼──────────────▼──────────────▼───────────────▼────┐  │
│  │                  Common Layer                          │  │
│  │  Guards (JWT, Verified, Roles) · Decorators · Filters  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┼──────────────┐
          ▼            ▼              ▼
     PostgreSQL      Redis        open.er-api.com
   (primary store) (rate cache)  (FX data source)
```

**Modules:**

| Module | Responsibility |
|--------|---------------|
| `AuthModule` | Registration, OTP email verification, JWT login |
| `UsersModule` | User CRUD and email lookup |
| `OtpModule` | 6-digit OTP generation and atomic verification |
| `MailModule` | Transactional email via SMTP (auto Ethereal in dev) |
| `WalletModule` | Fund, convert, trade — all atomic via QueryRunner |
| `FxModule` | 3-tier rate fetching: Redis → API → PostgreSQL |
| `TransactionsModule` | Paginated, filterable transaction history |
| `HealthModule` | DB + Redis liveness check |

---

## Setup Instructions

### Prerequisites

- Node.js 18+
- Docker and Docker Compose

### 1. Clone and install

```bash
git clone <repo-url>
cd credpal
npm install
```

### 2. Start infrastructure

```bash
docker-compose up -d
```

Starts PostgreSQL 15 on port `5432` and Redis 7 on port `6379`.

### 3. Configure environment

```bash
cp .env.example .env
```

The defaults work with the Docker Compose setup out of the box. Edit `JWT_SECRET` for production.

### 4. Run the app

```bash
npm run start:dev
```

The app starts on `http://localhost:3000`. Database tables are auto-created via TypeORM `synchronize: true`.

### 5. Verify it's healthy

```bash
curl http://localhost:3000/health
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP port | `3000` |
| `NODE_ENV` | `development` or `production` | `development` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USERNAME` | PostgreSQL user | `postgres` |
| `DB_PASSWORD` | PostgreSQL password | `postgres` |
| `DB_NAME` | Database name | `fx_trading_app` |
| `REDIS_HOST` | Redis host | `localhost` |
| `REDIS_PORT` | Redis port | `6379` |
| `JWT_SECRET` | JWT signing secret | _(required in prod)_ |
| `JWT_ACCESS_EXPIRY` | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRY` | Refresh token lifetime | `7d` |
| `MAIL_HOST` | SMTP host | _(auto Ethereal in dev)_ |
| `MAIL_USER` | SMTP username | _(auto Ethereal in dev)_ |
| `MAIL_PASS` | SMTP password | _(auto Ethereal in dev)_ |
| `FX_API_BASE_URL` | Exchange rate API base URL | `https://open.er-api.com/v6/latest` |
| `FX_RATE_CACHE_TTL` | Redis TTL for FX rates (seconds) | `300` |
| `FX_RATE_MAX_AGE` | Max age for DB fallback rates (seconds) | `1800` |

> **Dev email**: If `MAIL_USER` is unset or contains the placeholder value, the app auto-creates an [Ethereal](https://ethereal.email) test account on startup. OTP preview URLs are printed to the console.

---

## API Documentation

Swagger UI is available at:

```
http://localhost:3000/api/docs
```

### Endpoint Summary

#### Auth

| Method | Path | Description | Auth required |
|--------|------|-------------|---------------|
| `POST` | `/auth/register` | Register new user | No |
| `POST` | `/auth/verify` | Verify email with OTP | No |
| `POST` | `/auth/login` | Login, receive JWT tokens | No |
| `POST` | `/auth/resend-otp` | Resend verification OTP | No |

#### Wallet

| Method | Path | Description | Auth required |
|--------|------|-------------|---------------|
| `GET` | `/wallet` | Get all wallet balances | JWT + verified email |
| `POST` | `/wallet/fund` | Fund a currency wallet | JWT + verified email |
| `POST` | `/wallet/convert` | Convert between any two currencies | JWT + verified email |
| `POST` | `/wallet/trade` | Trade (must involve NGN) | JWT + verified email |

#### FX Rates

| Method | Path | Description | Auth required |
|--------|------|-------------|---------------|
| `GET` | `/fx/rates` | Get live exchange rates | No |

#### Transactions

| Method | Path | Description | Auth required |
|--------|------|-------------|---------------|
| `GET` | `/transactions` | Paginated + filtered history | JWT + verified email |

#### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | PostgreSQL + Redis status |

---

## Running Tests

### Unit tests (no DB required)

```bash
npm run test
```

| Suite | Tests |
|-------|-------|
| `AuthService` | 10 |
| `FxService` | 10 |
| `WalletService` | 16 |
| **Total** | **36** |

All mocked — no real database or Redis needed.

### E2E tests (requires Docker Compose stack)

```bash
docker-compose up -d   # ensure PostgreSQL + Redis are running
npm run test:e2e
```

Covers:
- Full flow: register → verify → login → fund → convert → balance check → transaction history
- Concurrent double-spend prevention via pessimistic locking

### Coverage report

```bash
npm run test:cov
```

---

## Key Assumptions

1. **Supported currencies** — `NGN`, `USD`, `EUR`, `GBP`. Wallets are created automatically on first use.
2. **NGN as base for trades** — `/wallet/trade` requires NGN on one side (buy or sell NGN). Direct cross-currency trades (e.g. USD → EUR) use `/wallet/convert`.
3. **Idempotency keys** — callers supply a unique key per request. Replaying the same key returns the original result without re-processing.
4. **Email verification gate** — all wallet and transaction endpoints require `is_email_verified = true`.
5. **4 decimal-place precision** — balances stored as `DECIMAL(20, 4)`; rates as `DECIMAL(20, 8)`. All arithmetic via `decimal.js`.
6. **Free FX API** — `open.er-api.com` requires no API key. Rate freshness is best-effort; stale rates (> 30 min) return a `503`.

---

## Architectural Decisions

### Atomic transactions via QueryRunner

Every balance-mutating operation wraps wallet reads, balance updates, and transaction record creation in a single PostgreSQL transaction through TypeORM's `QueryRunner`. Any failure triggers a full rollback — no partial state is ever committed.

### Pessimistic write locking (`SELECT ... FOR UPDATE`)

Both source and destination wallets are locked before any balance check. This serializes concurrent writes to the same wallet, preventing double-spend. The E2E test suite validates this: two concurrent requests for more than the available balance result in exactly one success and one `400`.

### Idempotency checked inside the transaction

The idempotency key is looked up as the very first step inside the database transaction, before any wallet is read or modified. A `UNIQUE` constraint on `idempotency_key` provides a final safety net at the database level.

### 3-tier FX caching

```
Request → Redis (5 min TTL)
            └── miss → open.er-api.com
                          └── error → PostgreSQL (max 30 min old)
                                         └── nothing fresh → 503
```

All Redis operations are wrapped in try-catch so a Redis failure transparently falls through to the API — no request is lost.

### Decimal precision

TypeORM returns `DECIMAL` columns as `string`. All arithmetic uses `decimal.js` constructed from those strings, avoiding IEEE 754 floating-point errors that would corrupt monetary values.

### Ethereal auto-account in development

`MailService` implements `OnModuleInit`. If no real SMTP credentials are configured, it calls `nodemailer.createTestAccount()` and logs Ethereal preview URLs per sent email, removing the need for any mail setup during development.

---

## Scalability Considerations

- **Stateless app layer** — JWT auth and Redis-shared cache allow horizontal scaling behind a load balancer with no sticky sessions.
- **Row-level locking** — `SELECT ... FOR UPDATE` serializes writes to individual wallets without blocking unrelated wallets, keeping contention minimal.
- **Queue-based writes (future)** — for extremely high wallet throughput, operations per wallet can be queued (e.g. BullMQ) to eliminate lock contention entirely.
- **Read replicas** — `/transactions` and `/wallet` (reads) can be directed to a PostgreSQL read replica once traffic warrants it.
- **Indexed queries** — transactions are indexed on `user_id` + `created_at`; the `idempotency_key` column has a `UNIQUE` index. Both support high-volume lookups without full table scans.
- **FX cache** — rates shared in Redis across all instances reduce external API calls to near-zero under normal load.
