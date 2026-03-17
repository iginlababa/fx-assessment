# Architecture & Flow Diagrams

---

## 1. System Architecture Overview

The application is a NestJS monolith with seven domain modules backed by PostgreSQL and Redis. All wallet and trading operations go through shared guards before reaching the relevant module.

```mermaid
graph TB
    Client["Client / Swagger UI"]

    subgraph App["NestJS Application"]
        direction TB

        subgraph Guards["Shared Infrastructure"]
            JWTGuard["JwtAuthGuard"]
            VerGuard["VerifiedUserGuard"]
            Filter["HttpExceptionFilter"]
            Pipe["ValidationPipe"]
        end

        Auth["AuthModule\n/auth/*"]
        Wallet["WalletModule\n/wallet/*"]
        Fx["FxModule\n/fx/*"]
        Trans["TransactionsModule\n/transactions"]
        Health["HealthModule\n/health"]

        Wallet -->|getExchangeRate| Fx
        Auth -->|createWallet| Wallet
    end

    subgraph Infra["Infrastructure"]
        PG[("PostgreSQL")]
        Redis[("Redis")]
    end

    ExtAPI["Exchange Rate API\nopen.er-api.com"]
    SMTP["SMTP Server\nNodemailer"]

    Client -->|HTTP| Guards
    Guards --> Auth
    Guards --> Wallet
    Guards --> Fx
    Guards --> Trans
    Guards --> Health

    Auth --> PG
    Auth --> SMTP
    Wallet --> PG
    Fx --> PG
    Fx --> Redis
    Fx --> ExtAPI
    Trans --> PG
    Health --> PG
    Health --> Redis
```

---

## 2. User Registration & Verification Flow

Registration creates a user, seeds their NGN wallet, and sends an OTP. Verification uses a single atomic `UPDATE … RETURNING` to prevent two concurrent requests from both succeeding on the same OTP.

```mermaid
sequenceDiagram
    actor User
    participant API as AuthController
    participant AS as AuthService
    participant US as UsersService
    participant WS as WalletService
    participant OS as OtpService
    participant Mail as MailService
    participant DB as PostgreSQL

    User->>API: POST /auth/register
    API->>AS: register(dto)
    AS->>US: findByEmail(email)
    US->>DB: SELECT users WHERE email = ?
    DB-->>AS: null (no conflict)
    AS->>AS: bcrypt.hash(password, 12)
    AS->>US: createUser(...)
    US->>DB: INSERT INTO users
    DB-->>AS: user
    AS->>WS: createWallet(userId, "NGN")
    WS->>DB: INSERT INTO wallets (balance: 0)
    AS->>OS: generateOtp(userId, EMAIL_VERIFICATION)
    OS->>DB: UPDATE otp_codes SET is_used=true WHERE unused
    OS->>DB: INSERT INTO otp_codes (expires_at: +10min)
    DB-->>AS: "123456"
    AS->>Mail: sendOtpEmail(email, otp, firstName)
    AS-->>API: { userId, message }
    API-->>User: 201 Created

    Note over User,DB: User receives OTP via email

    User->>API: POST /auth/verify
    API->>AS: verifyEmail({ email, otp })
    AS->>US: findByEmail(email)
    AS->>OS: verifyOtp(userId, otp, EMAIL_VERIFICATION)
    OS->>DB: UPDATE otp_codes SET is_used=true\nWHERE code=? AND is_used=false\nAND expires_at > NOW()\nRETURNING id
    Note over OS,DB: Atomic — concurrent requests cannot\nboth mark the same OTP used
    DB-->>OS: [{ id }] (1 row = valid)
    AS->>US: markEmailVerified(userId)
    US->>DB: UPDATE users SET is_email_verified=true
    AS-->>API: { message: "Email verified successfully." }
    API-->>User: 200 OK

    User->>API: POST /auth/login
    API->>AS: login({ email, password })
    AS->>US: findByEmail(email)
    AS->>AS: bcrypt.compare(password, hash)
    AS->>AS: jwtService.sign(payload, 15m) → accessToken
    AS->>AS: jwtService.sign(payload, 7d) → refreshToken
    AS-->>API: { accessToken, refreshToken, user }
    API-->>User: 200 OK
```

---

## 3. Currency Conversion Flow

The most critical path in the system. The entire operation — idempotency check, balance validation, rate fetch, debit, credit, and transaction record — runs inside a single PostgreSQL transaction with pessimistic row-level locks.

```mermaid
sequenceDiagram
    actor User
    participant API as WalletController
    participant WS as WalletService
    participant FX as FxService
    participant DB as PostgreSQL
    participant Redis

    User->>API: POST /wallet/convert\n{ fromCurrency, toCurrency, amount, idempotencyKey }
    Note over API: JwtAuthGuard + VerifiedUserGuard
    API->>WS: convertCurrency(userId, dto)

    alt fromCurrency === toCurrency
        WS-->>API: 400 Cannot convert to same currency
    end

    Note over WS,DB: BEGIN TRANSACTION

    WS->>DB: SELECT * FROM transactions\nWHERE idempotency_key = ?
    alt Duplicate idempotency key
        WS->>DB: COMMIT
        WS-->>API: Return original transaction result
    end

    WS->>DB: SELECT * FROM wallets\nWHERE user_id=? AND currency=fromCurrency\nFOR UPDATE
    Note over WS,DB: Row-level pessimistic lock —\nblocks concurrent writes to this wallet

    alt Wallet missing OR balance < amount
        WS->>DB: ROLLBACK
        WS-->>API: 400 Insufficient balance
    end

    WS->>FX: getExchangeRate(fromCurrency, toCurrency)
    FX->>Redis: GET fx_rate:{from}:{to}
    alt Redis hit
        Redis-->>WS: Decimal rate
    else Redis miss or error
        FX->>FX: fetchRatesFromApi(fromCurrency)
        alt API success
            FX->>Redis: SET fx_rate:* (5min TTL)
            FX->>DB: INSERT INTO fx_rates_cache (batch)
            FX-->>WS: Decimal rate
        else API failure — try cross-rate via USD
            FX->>FX: getRate(from→USD) × getRate(USD→to)
            alt Cross-rate available
                FX-->>WS: Decimal cross-rate
            else All sources fail
                FX->>DB: ROLLBACK
                FX-->>API: 503 FX rates unavailable
            end
        end
    end

    WS->>WS: toAmount = amount × rate (Decimal.js, 4dp)

    WS->>DB: UPDATE wallets SET balance = balance - amount\nWHERE user_id=? AND currency=fromCurrency
    WS->>DB: SELECT * FROM wallets\nWHERE user_id=? AND currency=toCurrency\nFOR UPDATE
    alt Destination wallet does not exist
        WS->>DB: INSERT INTO wallets (currency=toCurrency, balance=0)
    end
    WS->>DB: UPDATE wallets SET balance = balance + toAmount
    WS->>DB: INSERT INTO transactions\n(type, from/to currency+amount, rate, idempotency_key)

    Note over WS,DB: COMMIT TRANSACTION

    WS-->>API: { fromCurrency, toCurrency, fromAmount,\ntoAmount, rateUsed, transaction }
    API-->>User: 200 OK
```

---

## 4. FX Rate 3-Tier Caching Strategy

Rate lookups cascade through three tiers. On a successful API fetch, all rates for the base currency are persisted to both Redis and the DB in one go. On DB fallback, the stale rate is re-warmed into Redis with a shorter 1-minute TTL.

```mermaid
flowchart TD
    A([getRate request]) --> B{Redis cache?\nfx_rate:BASE:TARGET}
    B -->|Hit| C([Return cached rate])
    B -->|Miss or Redis down| D[Call Exchange Rate API\nfetch all rates for base currency]
    D -->|Success| E[Cache all rates in Redis\n5min TTL]
    E --> F[Persist all rates to\nfx_rates_cache table]
    F --> G([Return rate])
    D -->|Failure| H{DB fallback:\nfx_rates_cache\nfetched_at > NOW - 30min}
    H -->|Fresh row found| I[Re-warm Redis\n1min TTL]
    I --> J([Return stale DB rate])
    H -->|No fresh row| K([503 Service Unavailable])

    style C fill:#16a34a,color:#fff
    style G fill:#16a34a,color:#fff
    style J fill:#ca8a04,color:#fff
    style K fill:#dc2626,color:#fff
```

---

## 5. Wallet Funding Flow

Funding is simpler than conversion — no rate fetch needed — but uses the same QueryRunner transaction pattern with an idempotency guard and pessimistic lock.

```mermaid
sequenceDiagram
    actor User
    participant WS as WalletService
    participant DB as PostgreSQL

    User->>WS: POST /wallet/fund\n{ currency, amount, idempotencyKey }

    Note over WS,DB: BEGIN TRANSACTION

    WS->>DB: SELECT * FROM transactions\nWHERE idempotency_key = ?
    alt Duplicate key
        WS->>DB: COMMIT
        WS-->>User: Return original { wallet, transaction }
    end

    WS->>DB: SELECT * FROM wallets\nWHERE user_id=? AND currency=?\nFOR UPDATE
    alt Wallet does not exist
        WS->>DB: INSERT INTO wallets\n(currency, balance: '0.0000')
    end

    WS->>WS: newBalance = balance + amount (Decimal.js)
    WS->>DB: UPDATE wallets SET balance = newBalance
    WS->>DB: INSERT INTO transactions\n(type: 'funding', to_currency, to_amount)

    Note over WS,DB: COMMIT TRANSACTION

    WS-->>User: { wallet: { currency, newBalance },\ntransaction: { id, type, status, ... } }
```

---

## 6. Entity Relationship Diagram

Five tables. `users` is the root entity. `wallets` enforces a unique `(user_id, currency)` constraint — the vertical wallet model. `transactions` covers funding, conversions, and trades in a single table differentiated by `type`.

```mermaid
erDiagram
    USERS ||--o{ WALLETS : has
    USERS ||--o{ OTP_CODES : has
    USERS ||--o{ TRANSACTIONS : has

    USERS {
        uuid id PK
        varchar email UK
        varchar password_hash
        varchar first_name
        varchar last_name
        boolean is_email_verified
        enum role
        timestamp created_at
        timestamp updated_at
    }

    WALLETS {
        uuid id PK
        uuid user_id FK
        varchar currency
        decimal balance
        timestamp created_at
        timestamp updated_at
    }

    OTP_CODES {
        uuid id PK
        uuid user_id FK
        varchar code
        enum type
        timestamp expires_at
        boolean is_used
        timestamp created_at
    }

    TRANSACTIONS {
        uuid id PK
        uuid user_id FK
        enum type
        enum status
        varchar from_currency
        varchar to_currency
        decimal from_amount
        decimal to_amount
        decimal exchange_rate
        varchar idempotency_key UK
        jsonb metadata
        timestamp created_at
    }

    FX_RATES_CACHE {
        uuid id PK
        varchar base_currency
        varchar target_currency
        decimal rate
        timestamp fetched_at
        timestamp created_at
    }
```
