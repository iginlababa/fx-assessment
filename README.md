# FX Trading App — Backend API

A production-grade backend for an FX (Foreign Exchange) trading application built with NestJS, TypeORM, and PostgreSQL. Users can register, verify their email, fund multi-currency wallets, and trade/convert between Naira (NGN) and international currencies using real-time exchange rates.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | NestJS (TypeScript, strict mode) |
| ORM | TypeORM |
| Database | PostgreSQL 15 |
| Cache | Redis 7 |
| Auth | JWT (access + refresh tokens) via `@nestjs/passport` |
| Validation | `class-validator` + `class-transformer` |
| Decimal math | `decimal.js` |
| Email | Nodemailer (Ethereal in dev, SMTP in prod) |
| API Docs | Swagger (`@nestjs/swagger`) |
| Infrastructure | Docker Compose |
| Testing | Jest (unit) + Supertest (E2E) |

---

## Architecture Overview

```
src/
├── auth/          # Registration, login, OTP verification, JWT strategy
├── users/         # User entity and service
├── otp/           # OTP generation, validation, expiry
├── mail/          # Email service (Nodemailer SMTP)
├── wallet/        # Multi-currency wallets, funding, conversion, trading
├── fx/            # Real-time FX rates with 3-tier caching
├── transactions/  # Transaction history with pagination
├── health/        # Health check endpoint
└── common/        # Guards, decorators, filters, constants
```

Each domain is a self-contained NestJS module with its own controller, service, DTOs, and entities. The `common/` directory provides shared infrastructure: `JwtAuthGuard`, `VerifiedUserGuard`, `RolesGuard`, `@CurrentUser()` decorator, and the global `HttpExceptionFilter`.

---

## Flow Diagrams

Detailed architectural and flow diagrams are available in [`docs/architecture.md`](docs/architecture.md), including:

- System architecture overview
- Registration & verification flow
- Currency conversion flow (with pessimistic locking)
- FX rate 3-tier caching strategy
- Wallet funding flow
- Entity relationship diagram

---

## Setup Instructions

**Prerequisites**: Node.js 18+, Docker, Docker Compose

```bash
# 1. Clone the repository
git clone <repo-url>
cd fx-assessment

# 2. Install dependencies
npm install

# 3. Set up environment variables
cp .env.example .env
# Defaults work for the local Docker setup.
# For production: set JWT_SECRET, MAIL_HOST/USER/PASS, ADMIN_PASSWORD, NODE_ENV=production
# See the Environment Variables section below for the full reference.

# 4. Start infrastructure (PostgreSQL + Redis)
docker compose up -d

# 5. Start the application
npm run start:dev

# 6. Open API docs
# Visit http://localhost:3000/api/docs
```

In development (`NODE_ENV` is not `production`), TypeORM auto-syncs the schema on startup. In production, explicit migrations are used (see [Database Migrations](#database-migrations) below).

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values before starting the app. Several variables have no sensible default and **the app will not work without them**.

### Required — app will fail to start or core features will break

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USERNAME` | PostgreSQL user | `postgres` |
| `DB_PASSWORD` | PostgreSQL password | `postgres` |
| `DB_NAME` | PostgreSQL database name | `fx_trading_app` |
| `JWT_SECRET` | Secret used to sign JWTs — **must be a long random string in production** | `changeme` |

### Required for email — registration OTP will not be delivered without these

In development with no real credentials set, the app falls back to [Ethereal](https://ethereal.email) (a fake SMTP inbox). In production (`NODE_ENV=production`) or when real credentials are present, Nodemailer sends via your configured SMTP server.

| Variable | Description | Example |
|----------|-------------|---------|
| `MAIL_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `MAIL_PORT` | SMTP port (usually 587 for TLS) | `587` |
| `MAIL_USER` | SMTP login / sender address | `you@yourdomain.com` |
| `MAIL_PASS` | SMTP password or app password | `your_smtp_password` |

**Common providers:**
- **Gmail**: enable 2FA and generate an [App Password](https://myaccount.google.com/apppasswords). Use `smtp.gmail.com` / port `587`.
- **AWS SES**: use the SES SMTP endpoint for your region (e.g. `email-smtp.eu-west-1.amazonaws.com`) / port `587`.
- **SendGrid**: use `smtp.sendgrid.net` / port `587`, username `apikey`, password = your SendGrid API key.
- **Resend**: use `smtp.resend.com` / port `587`, username `resend`, password = your Resend API key.

### Optional — have sensible defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port the app listens on |
| `NODE_ENV` | `development` | Set to `production` to enable migrations, real SMTP, and disable sync |
| `REDIS_HOST` | `localhost` | Redis host (app works without Redis — falls back to in-memory cache) |
| `REDIS_PORT` | `6379` | Redis port |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token lifetime |
| `FX_API_BASE_URL` | `https://open.er-api.com/v6/latest` | Exchange rate API base URL |
| `FX_RATE_CACHE_TTL` | `300` | Redis cache TTL for FX rates in seconds |
| `FX_RATE_MAX_AGE` | `1800` | Max age in seconds for DB-cached rates before fallback fails |
| `ADMIN_EMAIL` | `admin@fxtradingapp.com` | Email for the auto-seeded admin account |
| `ADMIN_PASSWORD` | `Admin@123456` | Password for the auto-seeded admin account — **change this in production** |

---

## Database Migrations

In development, TypeORM auto-syncs the schema on startup (`synchronize: true`). For production, the app uses explicit migrations (`synchronize: false`, `migrationsRun: true`) which run automatically on startup.

```bash
# Generate a migration after changing entities
npm run migration:generate -- src/database/migrations/MigrationName

# Run pending migrations manually
npm run migration:run

# Revert the last migration
npm run migration:revert

# Show migration status
npm run migration:show
```

Migration files live in `src/database/migrations/` and are compiled to `dist/database/migrations/` before the CLI runs them. The standalone DataSource config used by the CLI is at `src/database/data-source.ts`.

---

## API Documentation

Full interactive documentation is available at **`http://localhost:3000/api/docs`** (Swagger UI).

### Endpoint Summary

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | No | Register and receive OTP via email |
| POST | `/auth/verify` | No | Verify email with OTP |
| POST | `/auth/login` | No | Login and receive JWT tokens |
| POST | `/auth/resend-otp` | No | Resend verification OTP |
| GET | `/wallet` | JWT + Verified | Get all wallet balances |
| POST | `/wallet/fund` | JWT + Verified | Fund a wallet |
| POST | `/wallet/convert` | JWT + Verified | Convert between any two currencies |
| POST | `/wallet/trade` | JWT + Verified | Trade involving NGN |
| GET | `/fx/rates` | No | Get current FX exchange rates |
| GET | `/transactions` | JWT + Verified | Paginated transaction history |
| GET | `/health` | No | Service health check |
| GET | `/admin/users` | JWT + Admin | List all users (paginated, searchable) |
| GET | `/admin/users/:id` | JWT + Admin | User details with wallets and transactions |
| GET | `/admin/transactions` | JWT + Admin | All transactions system-wide |
| GET | `/admin/stats` | JWT + Admin | System statistics dashboard |

---

## Role-Based Access Control

The application implements RBAC with two roles:

- **User** (`role: 'user'`): Default role. Can access wallet, trading, and transaction history endpoints.
- **Admin** (`role: 'admin'`): Can access everything a user can, plus dedicated admin endpoints for user management, system-wide transaction monitoring, and statistics.

Admin endpoints are protected by three guards stacked in order:

1. `JwtAuthGuard` — valid JWT required
2. `VerifiedUserGuard` — email must be verified
3. `RolesGuard` — user role must be `admin`

A default admin user is seeded on application startup (idempotent — skipped if the user already exists). Configurable via `ADMIN_EMAIL` and `ADMIN_PASSWORD` environment variables.

---

## Key Assumptions

1. **Wallet funding is simulated** — there is no real payment gateway integration. `POST /wallet/fund` directly credits the balance. This is intentional for an assessment context.

2. **FX rates are cached for 5 minutes.** All conversions within that window use the same cached rate. This avoids hammering the external API while keeping rates reasonably fresh.

3. **The trade endpoint enforces the NGN constraint.** `POST /wallet/trade` requires that one side of every pair is NGN (either buying or selling Naira). `POST /wallet/convert` has no such restriction and accepts any valid currency pair.

4. **OTPs expire after 10 minutes.** Only the most recently generated, unused OTP is valid. Requesting a new OTP via `/auth/resend-otp` invalidates all previous ones.

5. **All monetary values use `DECIMAL(18, 4)`.** Balances are stored and returned as strings to preserve precision — never floating-point.

6. **Exchange rates use `DECIMAL(18, 8)`.** This provides enough precision for pairs like NGN/USD where the rate is in the 0.0006xxxx range.

7. **Supported currencies at launch: NGN, USD, EUR, GBP.** Adding more requires a single change to the `SUPPORTED_CURRENCIES` constant in `src/common/constants/currencies.ts`. No schema migration is needed.

8. **JWT access tokens expire in 15 minutes; refresh tokens in 7 days.** These are configurable via `JWT_ACCESS_EXPIRY` and `JWT_REFRESH_EXPIRY` in `.env`.

9. **Redis is optional.** The app falls back to in-memory caching if Redis is unavailable. This means it boots and functions without Redis, at the cost of per-instance (non-shared) rate caching.

---

## Architectural Decisions

### PostgreSQL over MySQL
Better support for `DECIMAL` precision types, `SELECT ... FOR UPDATE` row-level locking, `JSONB` for transaction metadata, and more mature TypeORM integration.

### Vertical wallet model (one row per user per currency)
Rather than adding a column per currency, each wallet is its own row with a `(user_id, currency)` unique constraint. Adding a new currency requires zero schema migrations — just a config change. This also makes balance reads and writes far simpler.

### Pessimistic locking (`SELECT ... FOR UPDATE`)
Every balance read before a mutation uses `pessimistic_write` lock mode. This serializes concurrent writes to the same wallet row at the database level — preventing two simultaneous conversions from reading the same starting balance and both succeeding when only one should. The E2E concurrent double-spend test validates this.

### QueryRunner transactions
All balance mutations (fund, convert, trade) use a TypeORM `QueryRunner` to wrap the entire operation — wallet reads, balance updates, and transaction record creation — in a single atomic database transaction. If any step fails, the entire operation rolls back. No partial state is ever persisted.

### Idempotency keys
Every write endpoint requires a client-supplied idempotency key. The key is checked as the first step inside the database transaction. If a record with that key already exists, the original result is returned immediately without reprocessing. A `UNIQUE` constraint on `idempotency_key` serves as the final safety net, even if two requests race past the check. This makes retry-safe API calls trivial to implement on the client.

### 3-tier FX rate caching (Redis → API → DB)
```
Request → Redis (5 min TTL)
              └── miss → open.er-api.com
                            └── error → PostgreSQL fx_rates_cache (< 30 min old)
                                            └── nothing fresh → 503
```
Redis provides sub-millisecond reads for hot traffic. If Redis is down, we fall through to the API. If the API is down, we use the most recent persisted rate from the database. If all three fail, we return a `503` rather than silently using stale data for a trade. All Redis operations are wrapped in try-catch — a Redis failure is non-fatal.

### `decimal.js` for all monetary arithmetic
JavaScript's `number` type uses IEEE 754 floating-point, which causes precision errors (`0.1 + 0.2 !== 0.3`). All balance calculations use `Decimal` objects constructed from strings, with the result converted back to a fixed-precision string for storage. This eliminates all rounding errors on financial values.

### Separate Admin module
Admin endpoints live in `src/admin/` rather than being mixed into existing controllers. This keeps the regular user API surface clean and allows blanket RBAC to be applied at the controller level with a single `@Roles(UserRole.ADMIN)` decorator. The `AdminSeedService` runs on module init to ensure a default admin account exists in every environment without manual steps.

### Dual schema strategy (synchronize vs migrations)
Development uses `synchronize: true` for rapid iteration — no migration files needed when prototyping. Production uses `synchronize: false` with `migrationsRun: true`: migrations run automatically on app startup, schema changes are tracked in version control, and there's no risk of TypeORM silently dropping columns on a rename. The standalone `src/database/data-source.ts` file lets the TypeORM CLI generate and inspect migrations independently of the NestJS app.

### Trade vs Convert separation
Both endpoints use the same underlying `convertCurrency()` method. `tradeCurrency()` adds a single business rule: one side of the pair must be NGN. This keeps the implementation DRY while enforcing the domain constraint at a clean boundary.

---

## Security Considerations

- **Passwords** hashed with bcrypt at 12 salt rounds
- **Short-lived access tokens** (15 min) minimise exposure if a token is leaked
- **Email verification required** before accessing any trading feature
- **Rate limiting** on auth endpoints (5 req/min on register/login, 3/min on resend-otp) to prevent brute-force
- **Input validation** on every endpoint via `class-validator` + global `ValidationPipe`
- **Helmet** middleware sets security-relevant HTTP headers
- **CORS** configured to restrict allowed origins
- **Atomic OTP verification** via `UPDATE ... RETURNING` — prevents two concurrent verify requests from both succeeding with the same OTP
- **Error messages don't leak field specifics** — wrong email and wrong password produce the same `401` message

---

## Scalability Considerations

- **Stateless app layer** — JWT-based auth with Redis-shared cache means any number of instances can run behind a load balancer with no sticky sessions
- **Row-level locking** — `SELECT ... FOR UPDATE` serializes writes to individual wallet rows without blocking other wallets; contention is wallet-scoped, not table-scoped
- **Connection pooling** — TypeORM manages a PostgreSQL connection pool; `extra: { max: N }` in the TypeORM config can be tuned for high-throughput workloads
- **Read replicas** — balance checks and transaction history reads can be directed to a PostgreSQL read replica; write operations stay on the primary
- **FX rate background job** — rate fetching could move to a scheduled cron to pre-warm the cache and avoid thundering-herd cache expiry under heavy load
- **Transactions table partitioning** — for millions of rows, partition `transactions` by `created_at` (e.g., monthly) to keep history queries fast without full table scans
- **Async email** — `MailService.sendOtpEmail()` is called in-request; for scale, push emails to a message queue (e.g., BullMQ) and process them out-of-band

---

## Running Tests

```bash
# Unit tests (no DB or Redis needed)
npm run test

# E2E tests (requires PostgreSQL + Redis via docker compose up -d)
npm run test:e2e

# Coverage report
npm run test:cov
```

E2E tests always run with `NODE_ENV=test` and load `.env.example` (safe defaults), so they are unaffected by whatever is set in your local `.env`.

### Unit tests

| Suite | Tests |
|-------|-------|
| AuthService | 10 |
| FxService | 10 |
| WalletService | 16 |
| AdminService | 15 |
| RolesGuard | 8 |
| AppController | 1 |
| **Total** | **60** |

### E2E tests

| Suite | Tests |
|-------|-------|
| Full user flow (register → verify → login → fund → convert → trade → transactions) | 17 |
| Guard enforcement (401 / 403) | 7 |
| Concurrent double-spend prevention | 1 |
| Admin RBAC endpoints | 12 |
| **Total** | **36** |
