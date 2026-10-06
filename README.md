# SaaS Subscription Management API

> A production-ready Node.js & Express RESTful API backend for managing SaaS subscription lifecycles, Stripe Checkout payments, idempotent webhook processing, background invoice generation, Redis-cached analytics, and Model Context Protocol (MCP) AI integration.

---

## 1. Overview

The **SaaS Subscription Management API** is an enterprise-grade backend service built to manage the full lifecycle of recurring SaaS subscriptions. It solves the critical problem of securely and reliably processing recurring payments, managing subscription states, handling asynchronous Stripe webhooks, generating PDF invoices in background queues, and exposing real-time business analytics for AI clients.

### Main Functionality
* **Stripe Checkout Integration**: Synchronous creation of subscription checkout sessions with custom metadata tracking.
* **Idempotent Webhook Engine**: Asynchronous processing of Stripe webhook events (`checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`) wrapped inside PostgreSQL transactions and deduplicated via `processed_events`.
* **Background Queue & Email Worker**: Asynchronous PDF invoice generation using PDFKit and email delivery via Nodemailer/SMTP managed by BullMQ and Redis.
* **Automated Renewal & Expiry Sweeper**: Periodic subscription expiry sweeps and renewal reminder notifications powered by `node-cron` with Redis distributed locks.
* **Cached Business Analytics**: High-performance stats calculation (Active Subscribers, MRR, Total Revenue) cached in Redis with automatic TTL invalidation.
* **Model Context Protocol (MCP) Server**: Stdio-based AI server allowing AI agents to query subscriber analytics and expiring subscriptions via Zod-validated tools.

---

## 2. Key Features

* **User Management**: Automatic creation and lookup of customer profiles linked to Stripe Customer IDs.
* **Subscription State Machine**: Tracks subscription statuses (`active`, `past_due`, `canceled`, `expired`, `incomplete`) with support for billing intervals (`month`, `year`) and period end cancellations.
* **Stripe Checkout Session Creation**: Generates Stripe-hosted Checkout URLs for recurring subscription billing.
* **Stripe Webhook Signature Verification**: Enforces strict raw-body cryptographic signature verification (`stripe-signature`) against `STRIPE_WEBHOOK_SECRET`.
* **Idempotent Event Processing**: Database-backed deduplication table (`processed_events`) ensuring duplicate webhooks are safely ignored.
* **PostgreSQL Transaction Safety**: All database modifications inside webhook processing run within atomic transactions (`withTransaction`).
* **PDF Invoice Generation**: Automatic generation of branded PDF invoices saved locally to disk (`./invoices/`).
* **BullMQ Queue & Worker Architecture**: Offloads PDF creation and email sending to background worker threads backed by Redis.
* **Redis Caching Strategy**: Caches analytics summaries with automatic invalidation on subscription or payment state changes.
* **Distributed Cron Locking**: Prevents multi-instance race conditions during subscription expiry sweeps using Redis LUA locks.
* **Signed Download URLs**: Secure HMAC-SHA256 signed URLs with TTL for downloading PDF invoices without exposing sensitive keys.
* **Model Context Protocol (MCP) Tools**: Exposes 4 Zod-validated AI tools over Stdio (`get_active_subscribers`, `get_revenue_total`, `get_platform_summary`, `get_expiring_subscriptions`).
* **Centralized Error Handling & Rate Limiting**: Global Express error handler, custom `AppError` class, rate limiting on sensitive routes, and Pino structured logging.

---

## 3. Tech Stack

| Layer | Technology | Version | Description |
| :--- | :--- | :--- | :--- |
| **Runtime** | Node.js | `>=20.0.0` | Asynchronous JavaScript runtime (ES Modules) |
| **Framework** | Express.js | `v5.1.0` | Modern HTTP server framework |
| **Database** | PostgreSQL | `16-Alpine` | Relational persistence with `citext` and UUID support |
| **Cache & Queues** | Redis | `7-Alpine` | In-memory key-value store and BullMQ job runner |
| **Job Queue** | BullMQ | `v5.16.1` | Distributed background queue processor |
| **Payments** | Stripe API | `v17.7.0` | Subscription billing & checkout sessions |
| **PDF Generation** | PDFKit | `v0.20.2` | Vector graphics & text PDF invoice builder |
| **Mailer** | Nodemailer | `v10.0.15` | SMTP email transport client |
| **Scheduler** | node-cron | `v4.6.0` | In-process cron task scheduler |
| **AI Integration** | MCP SDK | `v1.32.0` | Model Context Protocol Stdio server |
| **Validation** | Zod | `v3.24.2` | TypeScript-first schema validation |
| **Logging** | Pino & Pino-HTTP | `v9.6.0` | Structured JSON application logger |
| **Containerization** | Docker & Compose | `v2+` | Containerized development environment |

---

## 4. Architecture

```mermaid
flowchart TD
    subgraph Clients
        C[Web Browser / Postman]
        AI[AI Client / MCP Host]
    end

    subgraph API_Server["Node.js Express API Server"]
        R[Express Router]
        CTL[Controllers]
        SVC[Services & Repositories]
        MW[Auth, Validation, RateLimit]
        MCP[MCP Server stdio]
        CRON[Expiry Cron Sweeper]
    end

    subgraph Infrastructure["Docker Infrastructure"]
        PG[(PostgreSQL 16 DB)]
        RD[(Redis 7 Cache & Queue)]
    end

    subgraph Background_Workers["BullMQ Workers"]
        WK[Email & Invoice Worker]
    end

    subgraph External_Services["External Services"]
        ST[Stripe API & Checkout]
        WH[Stripe Webhook Delivery]
        MAIL[SMTP Email Server]
    end

    C -->|POST /api/checkout| R
    AI <-->|Stdio JSON-RPC| MCP
    R --> MW --> CTL --> SVC
    SVC -->|Query / Transact| PG
    SVC -->|Cache / Lock| RD
    SVC -->|Create Session| ST
    ST -->|User Pays| C
    ST -->|Webhook Events| WH
    WH -->|POST /api/webhooks/stripe| R
    SVC -->|Enqueue Job| RD
    RD -->|Pull Job| WK
    WK -->|Generate PDF| DISK[Local ./invoices Directory]
    WK -->|Send Email| MAIL
    CRON -->|Sweep & Lock| RD
    CRON -->|Update Expired| PG
```

### Component Responsibilities:
1. **API Server (`src/server.js`, `src/app.js`)**: Entry point for HTTP requests, rate limiting, routing, CORS, and centralized error handling.
2. **PostgreSQL Database (`saas_postgres`)**: Primary database storing users, subscriptions, payments, generated invoice metadata, and idempotency audit logs (`processed_events`).
3. **Redis (`saas_redis`)**: In-memory database for BullMQ job queues (`invoice-email`, `renewal-reminders`), analytics summary caching (`stats:summary:*`), and distributed cron locking (`saas:jobs:expiry-lock`).
4. **Stripe API**: External payment provider managing Checkout links, customer profiles, prices, and subscriptions.
5. **Stripe Webhooks**: Asynchronous event router delivering event payloads to `/api/webhooks/stripe`.
6. **BullMQ Background Workers (`src/workers/`)**: Separate worker process consuming background jobs from Redis for PDF generation and SMTP delivery.
7. **Expiry Cron Sweeper (`src/jobs/expiry.cron.js`)**: Scheduled task sweeping expired subscriptions and enqueuing renewal reminders.
8. **MCP Server (`src/mcp/server.js`)**: Stdio server exposing analytics tools to AI agents.

---

## 5. Subscription & Payment Flow

```mermaid
flowchart TD
    A[User calls POST /api/checkout] --> B[Validate Request Body via Zod]
    B --> C[Lookup or Prepare Stripe Customer]
    C --> D[Create Stripe Checkout Session]
    D --> E[Return Session URL & SessionID to Client]
    E --> F[User Opens URL & Completes Payment on Stripe]
    F --> G[Stripe Cloud Fires Webhook Events]
    G --> H[POST /api/webhooks/stripe Received]
    H --> I[Verify Cryptographic Signature]
    I --> J{Already Processed?}
    J -- Yes (Duplicate) --> K[Return 200 OK duplicate: true]
    J -- No --> L[Begin PostgreSQL Transaction]
    L --> M[Record Event in processed_events]
    M --> N[Upsert User & Subscription Records]
    N --> O[Upsert Payment Record]
    O --> P[Commit Database Transaction]
    P --> Q[Invalidate Redis Analytics Cache]
    Q --> R[Enqueue Job to BullMQ Redis Queue]
    R --> S[Return 200 OK received: true]
    R --> T[Background Worker Picks Up Job]
    T --> U[Generate PDF Invoice with PDFKit]
    U --> V[Save PDF File to ./invoices/]
    V --> W[Send SMTP Email with PDF Attachment]
    W --> X[Mark email_sent_at in invoices Table]
```

### Synchronous vs. Webhook-Driven Operations
* **Synchronous (Request/Response)**: Creation of the Checkout session (`POST /api/checkout`) returns immediately with a Stripe payment URL. No subscription or payment rows are written to the database at this point.
* **Webhook-Driven (Asynchronous)**: Payment verification and database updates occur **exclusively via webhooks** sent by Stripe (`/api/webhooks/stripe`).

### Why Rely on Webhooks?
1. **Security & Integrity**: Frontend clients can be tampered with, closed early, or lose connection. Relying on Stripe webhooks ensures state is updated only when Stripe's servers verify payment.
2. **Resilience**: Stripe retries failed webhook deliveries automatically, guaranteeing event delivery even if the backend is temporarily offline.

---

## 6. Stripe Webhook Flow

```mermaid
sequenceDiagram
    autonumber
    participant U as User / Client
    participant API as Backend API
    participant S as Stripe Cloud
    participant WH as Webhook Endpoint
    participant DB as PostgreSQL DB
    participant RD as Redis Queue
    participant WK as BullMQ Worker

    U->>API: POST /api/checkout {email, name}
    API->>S: stripe.checkout.sessions.create()
    S-->>API: {url, sessionId}
    API-->>U: {success: true, data: {url, sessionId}}
    U->>S: Complete Payment on Stripe Page
    S->>WH: POST /api/webhooks/stripe (with stripe-signature header)
    WH->>WH: Verify Signature against STRIPE_WEBHOOK_SECRET
    WH->>DB: Check processed_events (Idempotency)
    alt Event Already Processed
        DB-->>WH: Duplicate Found
        WH-->>S: 200 OK {received: true, duplicate: true}
    else Event New
        WH->>DB: BEGIN Transaction
        WH->>DB: INSERT INTO processed_events
        WH->>DB: UPSERT users & subscriptions
        WH->>DB: UPSERT payments
        WH->>DB: COMMIT Transaction
        DB-->>WH: Transaction Committed
        WH->>RD: Enqueue invoice-email job
        WH-->>S: 200 OK {received: true, duplicate: false}
        RD->>WK: Pull invoice-email job
        WK->>WK: PDFKit generates INV-2026-XXXXXX.pdf
        WK->>Mail: Send Email with PDF Attachment
        WK->>DB: UPDATE invoices SET email_sent_at = NOW()
    end
```

### Webhook Engine Specifications:
* **Signature Header**: Expects `stripe-signature` header containing timestamp and HMAC signatures.
* **Raw Body Requirement**: The `/api/webhooks/stripe` route is mounted **before** `express.json()` using `express.raw({ type: 'application/json' })` to preserve exact byte-for-byte signature verification.
* **Webhook Signing Secret**: Configured via `STRIPE_WEBHOOK_SECRET` (`whsec_...`).
* **Supported Events**:
  - `checkout.session.completed` / `checkout.session.async_payment_succeeded`
  - `customer.subscription.created` / `customer.subscription.updated` / `customer.subscription.deleted`
  - `invoice.paid` / `invoice.payment_succeeded`
  - `invoice.payment_failed`
* **Idempotency**: Webhook IDs (`evt_...`) are inserted into `processed_events`. Duplicate payloads immediately abort further execution and return `200 OK { duplicate: true }`.

---

## 7. Database Architecture

### Entity-Relationship (ER) Diagram

```mermaid
erDiagram
    users ||--o{ subscriptions : "has many"
    subscriptions ||--o{ payments : "has many"
    subscriptions ||--o{ invoices : "has many"
    payments ||--o| invoices : "generates"

    users {
        uuid id PK "gen_random_uuid()"
        citext email UK "NOT NULL, Unique"
        text name "Customer Name"
        text stripe_customer_id UK "Unique Stripe ID"
        timestamptz created_at "Default NOW()"
        timestamptz updated_at "Default NOW()"
    }

    subscriptions {
        uuid id PK "gen_random_uuid()"
        uuid user_id FK "REFERENCES users(id)"
        text stripe_subscription_id UK "Unique Stripe Sub ID"
        text stripe_price_id "Stripe Price ID"
        text plan "Plan Name"
        text status "CHECK IN ('active','past_due','canceled','expired','incomplete')"
        text stripe_status "Native Stripe Status"
        integer amount_cents "CHECK >= 0"
        text currency "Default 'usd'"
        text billing_interval "CHECK IN ('day','week','month','year')"
        integer interval_count "Default 1"
        timestamptz start_date "Subscription Start"
        timestamptz end_date "Subscription End"
        boolean reminder_sent "Default false"
        boolean cancel_at_period_end "Default false"
        timestamptz created_at "Default NOW()"
        timestamptz updated_at "Default NOW()"
    }

    payments {
        uuid id PK "gen_random_uuid()"
        uuid subscription_id FK "REFERENCES subscriptions(id)"
        text stripe_invoice_id UK "Unique Stripe Invoice ID"
        text stripe_payment_intent_id "Stripe PaymentIntent ID"
        integer amount_cents "CHECK >= 0"
        text currency "Default 'usd'"
        text status "CHECK IN ('paid','failed')"
        timestamptz paid_at "Timestamp of Payment"
        timestamptz created_at "Default NOW()"
    }

    invoices {
        uuid id PK "gen_random_uuid()"
        uuid payment_id UK, FK "REFERENCES payments(id)"
        uuid subscription_id FK "REFERENCES subscriptions(id)"
        text invoice_number UK "Unique INV-2026-XXXXXX"
        text file_path "Filename on disk"
        integer amount_cents "CHECK >= 0"
        timestamptz email_sent_at "Delivery Timestamp"
        timestamptz created_at "Default NOW()"
    }

    processed_events {
        text stripe_event_id PK "Stripe Event ID (evt_...)"
        text event_type "Stripe Event Type"
        timestamptz processed_at "Default NOW()"
    }
```

### Table Indexing & Triggers
* `idx_subscriptions_status_end_date`: Optimized index on `subscriptions(status, end_date)` for fast cron sweep queries.
* `idx_subscriptions_user_id`: Index on `subscriptions(user_id)` for relational lookups.
* `idx_users_email`: Index on `users(email)` for fast user queries.
* `idx_payments_subscription_id`: Index on `payments(subscription_id)` for subscription revenue calculations.
* `idx_payments_status_created_at`: Index on `payments(status, created_at)` for revenue calculations.
* `trg_users_updated_at` & `trg_subscriptions_updated_at`: PostgreSQL triggers executing `update_updated_at_column()` on record updates.

---

## 8. Redis Usage & Caching Strategy

Redis is used for three distinct operational purposes:

### 1. Job Queues (BullMQ)
* **Queues**: `invoice-email` and `renewal-reminders`.
* **Behavior**: Stores background job payloads, handles exponential backoff retries (5 attempts, 5s initial delay), and keeps job execution logs.

### 2. Analytics Caching
* **Key Structure**: `stats:summary:<currency>` (e.g. `stats:summary:usd`).
* **TTL Strategy**: Configurable via `STATS_CACHE_TTL_SECONDS` (default: 300 seconds / 5 minutes).
* **Invalidation Strategy**: Automatically invalidated whenever a subscription state updates or a payment succeeds (`cacheService.invalidate('stats:summary:*')`).

### 3. Distributed Cron Locking
* **Key Structure**: `saas:jobs:expiry-lock`.
* **Behavior**: Implements atomic `SET key token EX 300 NX` with LUA script releasing to guarantee that only one node runs the subscription expiry sweep cycle in multi-instance deployments.

### Fallback Behavior
If Redis becomes unavailable, the system logs warnings and falls back gracefully to direct PostgreSQL queries for stats calculations.

---

## 9. Project Structure

```text
saas_backend/
├── docker-compose.yml         # Container configuration (PostgreSQL, Redis, pgAdmin)
├── package.json               # Dependencies, scripts, and Node engine requirements
├── eslint.config.js           # ESLint configuration
├── .dockerignore              # Docker build ignore rules
├── .gitignore                 # Git ignore rules
├── .env.example               # Environment variable templates
├── POSTMAN_GUIDE.md           # Postman collection & API guide
├── README.md                  # Project documentation
├── sql/
│   └── init.sql               # PostgreSQL schema & initialization script
├── invoices/                  # Local storage for generated PDF invoice files
├── logger/
│   └── app.log                # Pino application log output
├── scripts/
│   ├── test_mcp_chat.js       # Interactive MCP query CLI script
└── src/
    ├── server.js              # Application HTTP server entrypoint
    ├── app.js                 # Express application setup (Middleware, CORS, Routes)
    ├── config/
    │   ├── db.js              # PostgreSQL pool & transaction helper (withTransaction)
    │   ├── env.js             # Zod schema validation & environment loading
    │   ├── logger.js          # Pino logger setup
    │   ├── mailer.js          # Nodemailer SMTP transporter
    │   ├── redis.js           # Redis client setup
    │   └── stripe.js          # Stripe SDK client initialization
    ├── controllers/
    │   ├── checkout.controller.js # Checkout session creation & success redirects
    │   ├── health.controller.js   # /health and /ready readiness probes
    │   ├── invoice.controller.js  # Protected & signed PDF invoice download
    │   ├── stats.controller.js    # Business analytics API handler
    │   └── webhook.controller.js  # Stripe raw-body webhook signature validator
    ├── jobs/
    │   └── expiry.cron.js     # Scheduled task sweeper & renewal reminder scheduler
    ├── mcp/
    │   ├── server.js          # Model Context Protocol Stdio server & AI tools
    │   └── stdio-guard.js     # Console output redirect for clean stdio JSON-RPC
    ├── middlewares/
    │   ├── auth.js            # RequireApiKey middleware (timing-safe X-API-Key check)
    │   ├── errorHandler.js    # Global AppError & Express error handler
    │   ├── notFound.js        # 404 Route Not Found handler
    │   ├── requestId.js       # UUID X-Request-ID attribution
    │   └── validate.js        # Zod request schema validation middleware
    ├── queues/
    │   └── queues.js          # BullMQ queue declarations & job options
    ├── repositories/
    │   ├── event.repo.js      # processed_events database operations
    │   ├── invoice.repo.js    # invoices database operations
    │   ├── payment.repo.js    # payments database operations
    │   ├── subscription.repo.js # subscriptions database operations
    │   └── user.repo.js       # users database operations
    ├── routes/
    │   ├── checkout.routes.js # Route definitions for /api/checkout
    │   ├── health.routes.js   # Route definitions for /health & /ready
    │   ├── invoice.routes.js  # Route definitions for /api/invoices/:id/download
    │   ├── stats.routes.js    # Route definitions for /api/stats
    │   └── webhook.routes.js  # Route definitions for /api/webhooks/stripe
    ├── services/
    │   ├── cache.service.js   # Redis stats caching wrapper
    │   ├── email.service.js   # PDF invoice attachment email sender
    │   ├── invoice.service.js # PDFKit invoice generator
    │   ├── stats.service.js   # Revenue & active subscriber stats calculator
    │   ├── stripe.service.js  # Stripe Checkout & API wrapper
    │   ├── subscription.service.js # Subscription state lifecycle management
    │   └── webhook.service.js # Idempotent webhook event router & transaction logic
    ├── utils/
    │   ├── AppError.js        # Custom Operational Error class
    │   ├── async.js           # Timeout utilities
    │   ├── asyncHandler.js    # Express async wrapper
    │   ├── dates.js           # ISO timestamp converters
    │   ├── mask.js            # Customer email privacy masker
    │   ├── money.js           # Currency formatting helper
    │   ├── signedLink.js      # HMAC-SHA256 URL signing & verification
    │   └── stripeMapper.js    # Stripe object extractor & status mapper
    └── workers/
        ├── email.worker.js    # BullMQ worker for PDF generation & email delivery
        ├── index.js           # Standalone background worker runner
        └── reminder.worker.js # BullMQ worker for renewal reminder delivery
```

---

## 10. Prerequisites

Before running the application, ensure the following tools are installed:

* **Node.js**: Version `>=20.0.0`
* **npm**: Version `>=9.0.0`
* **Docker Desktop**: Version `^24.0.0` (with Docker Compose `v2+`)
* **Stripe CLI**: For local webhook forwarding (`v1.15.0+`)
* **Stripe Account**: Test mode keys (`sk_test_...`)

---

## 11. Environment Configuration

All environment variables are validated at startup using Zod in [src/config/env.js](file:///d:/bitcot_node_js_interview/saas_platform/saas_backend/src/config/env.js).

| Variable | Required | Description | Example / Default |
| :--- | :--- | :--- | :--- |
| `PORT` | Yes | HTTP Server Listening Port | `3000` |
| `NODE_ENV` | Yes | Runtime Environment (`development`, `test`, `production`) | `development` |
| `APP_BASE_URL` | Yes | Application Base URL | `http://localhost:3000` |
| `DATABASE_URL` | Yes | PostgreSQL Connection String | `postgresql://postgres:postgres@123@localhost:5433/saasdb` |
| `REDIS_URL` | Yes | Redis Connection String | `redis://localhost:6379` |
| `STRIPE_SECRET_KEY` | Yes | Stripe Test Secret Key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Yes | Stripe Webhook Signing Secret | `whsec_...` |
| `STRIPE_PRICE_ID` | Yes | Recurring Stripe Price ID | `price_...` |
| `CHECKOUT_SUCCESS_URL` | Yes | Checkout Success Redirect URL | `http://localhost:3000/checkout/success` |
| `CHECKOUT_CANCEL_URL` | Yes | Checkout Cancel Redirect URL | `http://localhost:3000/checkout/cancel` |
| `MAIL_HOST` | Yes | SMTP Server Host | `smtp.gmail.com` |
| `MAIL_PORT` | Yes | SMTP Server Port | `587` |
| `MAIL_USER` | Yes | SMTP Username | `your-email@gmail.com` |
| `MAIL_PASS` | Yes | SMTP Password / Google App Password | `16-char-app-password` |
| `MAIL_FROM` | Yes | Sender Email Address & Name | `"SaaS Platform <noreply@example.com>"` |
| `ADMIN_API_KEY` | Yes | Key required for protected endpoints (min 16 chars) | `secret-admin-key-min-16-chars-long` |
| `INVOICE_LINK_SECRET` | Yes | HMAC Signing key for invoice download URLs | `secret-admin-key-min-16-chars-long` |
| `INVOICE_LINK_TTL_HOURS`| No | Signed Invoice URL Lifetime (Hours) | `24` |
| `CRON_SCHEDULE` | No | Expiry Sweep Cron Schedule | `0 9 * * *` (or `*/1 * * * *`) |
| `CRON_TIMEZONE` | No | Cron Timezone | `UTC` |
| `CRON_RUN_ON_START` | No | Run cron sweep immediately on startup | `false` |
| `REMINDER_DAYS_BEFORE` | No | Days before expiration to send reminder | `7` |
| `EXPIRY_GRACE_HOURS` | No | Grace period in hours before expiration | `24` |
| `STATS_CACHE_TTL_SECONDS`| No | Cache TTL for stats summary | `300` |
| `INVOICE_DIR` | No | Directory path for PDF invoices | `./invoices` |
| `LOG_LEVEL` | No | Pino Logger level (`info`, `debug`) | `info` |
| `CORS_ORIGINS` | No | Allowed CORS Origins | `http://localhost:3000` |
| `WORKER_CONCURRENCY` | No | Worker concurrency count | `2` |

> [!CAUTION]
> **Security Notice**: Never commit `.env` or `.env.development` files containing real API keys or credentials to Git repositories. Always copy `.env.example` to `src/.env.development` and configure local values.

---

## 12. Local Development Setup

Follow these exact steps to start the application on a clean machine:

### Step 1 — Clone the Repository
```bash
git clone <repository-url>
cd saas_backend
```

### Step 2 — Install Dependencies
```bash
npm install
```

### Step 3 — Configure Environment Variables
Copy `.env.example` to `src/.env.development`:
```bash
cp .env.example src/.env.development
```
Edit `src/.env.development` and insert your test `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and SMTP credentials.

### Step 4 — Start Docker Infrastructure
Start PostgreSQL, Redis, and pgAdmin containers:
```bash
docker compose up -d
```
Verify all containers are running and healthy:
```bash
docker compose ps
```

### Step 5 — Start Application & Background Worker
Start the Express API server (which automatically initializes the background email worker):
```bash
npm run dev
```

### Step 6 — Verify Service Health
Test the health probe endpoint:
```bash
curl http://localhost:3000/health
```
Response:
```json
{
  "status": "ok",
  "timestamp": "2026-10-06T14:50:00.000Z",
  "service": "saas-backend"
}
```

---

## 13. Docker Configuration

The application uses `docker-compose.yml` to orchestrate local infrastructure:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: saas_postgres
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres@123}
      POSTGRES_DB: ${POSTGRES_DB:-saasdb}
    ports:
      - "${POSTGRES_PORT:-5433}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./sql/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d saasdb"]

  redis:
    image: redis:7-alpine
    container_name: saas_redis
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD-SHELL", "redis-cli ping | grep PONG"]

  pgadmin:
    image: dpage/pgadmin4:8
    container_name: saas_pgadmin
    ports:
      - "${PGADMIN_PORT:-5050}:80"
```

### Port Mapping Summary

| Service | Host Port | Container Port | Access URL / Details |
| :--- | :--- | :--- | :--- |
| **PostgreSQL** | `5433` | `5432` | `localhost:5433` (`saasdb`) |
| **Redis** | `6379` | `6379` | `localhost:6379` |
| **pgAdmin** | `5050` | `80` | `http://localhost:5050` (`admin@example.com` / `admin`) |

---

## 14. Database Initialization

Database schemas and indexes are defined in `sql/init.sql`.

### Docker Initialization Behavior
When Docker starts PostgreSQL for the first time, it mounts `./sql/init.sql` into `/docker-entrypoint-initdb.d/init.sql:ro` and automatically executes the schema definition script.

> [!IMPORTANT]
> **Docker Volume Persistence**: PostgreSQL initialization scripts run **only once** when the `pgdata` volume is created. If you alter `sql/init.sql` later, you must recreate the volume:
> ```bash
> docker compose down -v
> docker compose up -d
> ```
> *Warning: `docker compose down -v` deletes all existing local PostgreSQL volume data.*

---

## 15. Stripe CLI & Local Webhook Setup

To forward live test webhooks from Stripe to your local Express server:

### Step 1: Install & Login to Stripe CLI
```bash
stripe login
```

### Step 2: Start Local Webhook Listener
Run the webhook listener targeting your exact API key and local route:
```bash
stripe listen --api-key <YOUR_STRIPE_SECRET_KEY> --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_succeeded,invoice.payment_failed --forward-to localhost:3000/api/webhooks/stripe
```

### Step 3: Copy Webhook Signing Secret
Stripe CLI will print:
```text
> Ready! Your webhook signing secret is whsec_8c635428a31...
```
Copy `whsec_...` and set `STRIPE_WEBHOOK_SECRET=whsec_...` in `src/.env.development`.

### Step 4: Trigger Simulation Events
In a separate terminal, trigger sample events:
```bash
stripe trigger customer.subscription.created
stripe trigger invoice.payment_succeeded
```

---

## 16. API Documentation

### Complete Endpoint Reference

| Method | Endpoint | Purpose | Authentication | Rate Limit |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/checkout` | Create Stripe Checkout Session | Public | 10 req/min |
| `GET` | `/checkout/success` | Stripe Redirect Success Page | Public | 120 req/min |
| `GET` | `/checkout/cancel` | Stripe Redirect Cancel Page | Public | 120 req/min |
| `POST` | `/api/webhooks/stripe` | Process Stripe Webhook Events | Stripe Signature | 120 req/min |
| `GET` | `/api/stats` | Get Cached SaaS Business Stats | Header `x-api-key` | 120 req/min |
| `GET` | `/api/invoices/:id/download` | Download Invoice PDF File | Signed URL or `x-api-key` | 120 req/min |
| `GET` | `/health` | Liveness Health Check | Public | None |
| `GET` | `/ready` | Readiness Probe Check | Public | None |

---

### Endpoint Details & Examples

#### 1. Create Checkout Session (`POST /api/checkout`)
* **Headers**: `Content-Type: application/json`
* **Request Body**:
  ```json
  {
    "email": "customer@example.com",
    "name": "Jane Doe"
  }
  ```
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "sessionId": "cs_test_a1B2c3D4...",
      "url": "https://checkout.stripe.com/c/pay/cs_test_a1B2c3D4..."
    }
  }
  ```
* **Validation Error (`400 Bad Request`)**:
  ```json
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Valid email address is required"
    }
  }
  ```

---

#### 2. Stripe Webhook Listener (`POST /api/webhooks/stripe`)
* **Headers**: `stripe-signature: t=...,v1=...`
* **Request Body**: Raw JSON Buffer payload from Stripe.
* **Success Response (`200 OK`)**:
  ```json
  {
    "received": true,
    "duplicate": false
  }
  ```

---

#### 3. SaaS Business Analytics (`GET /api/stats?currency=usd`)
* **Headers**: `x-api-key: secret-admin-key-min-16-chars-long`
* **Query Parameters**: `currency=usd` (optional, default `usd`)
* **Success Response (`200 OK`)**:
  ```json
  {
    "success": true,
    "data": {
      "activeSubscribers": 4,
      "expiringSoon": 0,
      "currency": "usd",
      "totalRevenueCents": 3500,
      "totalRevenueFormatted": "$35.00",
      "monthlyRecurringRevenueCents": 5000,
      "revenueByCurrency": {
        "usd": 3500
      },
      "generatedAt": "2026-10-06T14:50:00.000Z",
      "cached": true
    }
  }
  ```

---

#### 4. Download PDF Invoice (`GET /api/invoices/:id/download`)
* **Headers**: `x-api-key: secret-admin-key-min-16-chars-long` (OR query params `?expires=...&sig=...`)
* **Success Response (`200 OK`)**: Returns PDF binary buffer with `Content-Type: application/pdf` and `Content-Disposition: attachment; filename="INV-2026-000001.pdf"`.

---

## 17. Error Handling

The application implements a centralized error handling strategy utilizing custom `AppError` instances, Express error middleware, and Pino structured logging.

### Error Response Format
All error responses adhere to a consistent JSON structure:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error description"
  }
}
```

### Implemented HTTP Status Mapping

| Status Code | Error Code | Trigger Condition |
| :--- | :--- | :--- |
| `400` | `VALIDATION_ERROR` | Invalid JSON body or Zod validation failure |
| `400` | `INVALID_SIGNATURE` | Stripe webhook signature verification failure |
| `401` | `UNAUTHORIZED` | Missing or invalid `x-api-key` / signed URL |
| `404` | `NOT_FOUND` | Route or resource not found |
| `429` | `TOO_MANY_REQUESTS` | Rate limit threshold exceeded |
| `500` | `INTERNAL_SERVER_ERROR` | Unhandled database or system exception |

---

## 18. Webhook Reliability & Idempotency

### Duplicate Handling Mechanism
Stripe guarantees at-least-once delivery, which can result in duplicate webhook payloads. To prevent duplicate data insertion or double billing:

1. **Audit Table (`processed_events`)**: Stores every processed `stripe_event_id` (`evt_...`).
2. **Idempotency Pre-Check**: Before processing, the webhook handler queries `processed_events`. If found, execution halts immediately and returns `200 OK { duplicate: true }`.
3. **Atomic Database Transactions**: Database mutations for users, subscriptions, and payments are wrapped inside `withTransaction(async (tx) => { ... })`.

```sql
INSERT INTO processed_events (stripe_event_id, event_type)
VALUES ($1, $2)
ON CONFLICT (stripe_event_id) DO NOTHING;
```

---

## 19. Security

* **Environment Secret Isolation**: Credentials kept out of source code.
* **Stripe Webhook Signature Verification**: Cryptographic validation using `stripe.webhooks.constructEvent()`.
* **Timing-Safe Key Comparison**: API Keys checked via `crypto.timingSafeEqual()` to prevent timing attacks.
* **HMAC-SHA256 Signed Links**: Expiration-backed signed links for secure invoice downloads without key exposure.
* **Parameterized SQL Queries**: All PostgreSQL queries use parameterized placeholders (`$1, $2`) preventing SQL injection.
* **Rate Limiting**: Route-specific limiters on sensitive endpoints (`/api/checkout`, `/api/stats`).
* **Customer Data Masking**: Privacy masker for emails (`d***n@gmail.com`) when displaying logs or MCP responses.

---

## 20. Model Context Protocol (MCP) Integration

The project includes an **MCP Server** ([src/mcp/server.js](file:///d:/bitcot_node_js_interview/saas_platform/saas_backend/src/mcp/server.js)) implementing the Stdio transport protocol to allow AI agents to inspect the SaaS platform.

### Running the MCP Server
```bash
npm run mcp
```

### Interactive MCP Query Tester
Run the interactive CLI test script to test MCP tools in terminal:
```bash
npm run mcp:test
```

---

## 21. Useful Commands Cheat Sheet

### NPM Scripts
```bash
npm run dev        # Start API server with file watch & auto email worker
npm run start      # Start API server in production mode
npm run worker     # Start standalone BullMQ background workers
npm run cron       # Start standalone subscription expiry cron scheduler
npm run mcp        # Start Model Context Protocol stdio server
npm run mcp:test   # Start interactive MCP terminal query tester
npm run seed:demo  # Seed demo users & subscriptions into database
```

### Docker Commands
```bash
docker compose up -d                     # Start infrastructure
docker compose ps                        # View running containers
docker compose logs -f postgres          # Tail PostgreSQL logs
docker compose logs -f redis             # Tail Redis logs
docker compose restart                   # Restart all containers
docker compose down                      # Stop containers
docker compose down -v                   # Hard reset (deletes DB volumes)
```

### Database Management Commands
```bash
# Query users table
docker exec saas_postgres psql -U postgres -d saasdb -c "SELECT * FROM users;"

# Query subscriptions table
docker exec saas_postgres psql -U postgres -d saasdb -c "SELECT * FROM subscriptions;"

# Query payments table
docker exec saas_postgres psql -U postgres -d saasdb -c "SELECT * FROM payments;"

# Truncate all database tables for clean testing
docker exec saas_postgres psql -U postgres -d saasdb -c "TRUNCATE TABLE invoices, payments, subscriptions, users, processed_events RESTART IDENTITY CASCADE;"

# Flush Redis cache & job queues
docker exec saas_redis redis-cli FLUSHALL
```

---

## 22. Troubleshooting

### 1. Dual PostgreSQL Instance Port Collision on Windows
* **Symptom**: `docker exec saas_postgres psql` shows 0 rows after payment.
* **Cause**: Local native Windows PostgreSQL service (`postgresql-x64-18`) running on port `5432` intercepts connections before Docker.
* **Fix**: In `docker-compose.yml`, Docker PostgreSQL is mapped to host port `5433` (`"5433:5432"`), and `DATABASE_URL` in `src/.env.development` is set to `localhost:5433`.

### 2. Stripe Webhook 500 Error / Account Mismatch
* **Symptom**: `stripe listen` shows events received, but API returns 500 or fails signature check.
* **Cause**: Stripe CLI is listening to a different Stripe account than `STRIPE_SECRET_KEY`.
* **Fix**: Pass your API key explicitly to Stripe CLI:
  ```bash
  stripe listen --api-key <YOUR_STRIPE_SECRET_KEY> --forward-to localhost:3000/api/webhooks/stripe
  ```

### 3. Email Worker `535 Authentication Error`
* **Symptom**: Pino logger reports `EAUTH Invalid login` when sending invoice emails.
* **Cause**: Normal Gmail password used instead of a Google App Password.
* **Fix**: Generate a 16-character Google App Password from [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) and set it in `MAIL_PASS`.

---

## 23. Production Considerations

### Implemented vs. Production Recommendations

| Feature Area | Currently Implemented | Recommended for Production |
| :--- | :--- | :--- |
| **SSL / HTTPS** | Plain HTTP (`http://localhost:3000`) | NGINX / Cloudflare reverse proxy with TLS certificate |
| **Stripe Keys** | Test mode keys (`sk_test_...`) | Encrypted secret vault with live keys (`sk_live_...`) |
| **Database Scaling** | Single Docker PostgreSQL instance | Managed AWS RDS PostgreSQL with Multi-AZ replication |
| **Migrations** | `sql/init.sql` schema auto-load | Prisma / Knex migration runner |
| **Redis High Availability**| Single Docker Redis instance | Redis Sentinel or AWS ElastiCache cluster |
| **Email Transport** | Direct Nodemailer SMTP | AWS SES / SendGrid API with DKIM & SPF records |

---

## 24. Assessment Requirements Compliance Matrix

| Assessment Requirement | Implementation Component | Verification Status |
| :--- | :--- | :--- |
| **Stripe Subscription Checkout** | `src/services/stripe.service.js` | ✅ Implemented & Verified |
| **Idempotent Webhooks** | `src/services/webhook.service.js` | ✅ Implemented & Verified |
| **PostgreSQL Persistence** | `sql/init.sql`, `src/config/db.js` | ✅ Implemented & Verified |
| **Redis Caching & Queues** | `src/services/cache.service.js`, `BullMQ` | ✅ Implemented & Verified |
| **Background PDF Invoices** | `src/services/invoice.service.js` | ✅ Implemented & Verified |
| **Expiry Sweeper & Cron** | `src/jobs/expiry.cron.js` | ✅ Implemented & Verified |
| **Model Context Protocol (MCP)** | `src/mcp/server.js` | ✅ Implemented & Verified |
| **Dockerized Infrastructure** | `docker-compose.yml` | ✅ Implemented & Verified |

---

## 25. Complete System End-to-End Diagram

```mermaid
flowchart TD
    subgraph Client_Interaction["1. Client Requests"]
        A[Client POST /api/checkout]
    end

    subgraph API_Processing["2. API Server & Stripe"]
        B[Validate Body Zod]
        C[Create Stripe Checkout Session]
        D[Client Pays on Stripe Hosted Page]
    end

    subgraph Webhook_Ingestion["3. Webhook Pipeline"]
        E[Stripe Fires Webhook Event]
        F[Verify Cryptographic Signature]
        G[Idempotency Pre-Check processed_events]
    end

    subgraph Persistence_Layer["4. PostgreSQL Transaction"]
        H[Begin Transaction]
        I[Upsert Users & Subscriptions]
        J[Upsert Payments]
        K[Commit Transaction]
    end

    subgraph Queue_Worker_Layer["5. Redis & Worker Execution"]
        L[Invalidate Redis Cache stats:summary:*]
        M[Enqueue BullMQ Job invoice-email-queue]
        N[BullMQ Worker Processes Job]
        O[PDFKit Generates Invoice File ./invoices/]
        P[Nodemailer Delivers SMTP Email]
        Q[Update invoices.email_sent_at]
    end

    A --> B --> C --> D --> E --> F --> G
    G -->|Unique Event| H --> I --> J --> K
    K --> L & M
    M --> N --> O --> P --> Q
```

---

## 26. Submission & Evaluation Notes

### Quick Start Guide for Evaluators:

1. **Start Infrastructure**:
   ```bash
   docker compose up -d
   ```
2. **Configure Environment**: Copy `.env.example` to `src/.env.development` and populate `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, and `STRIPE_WEBHOOK_SECRET`.
3. **Start Application**:
   ```bash
   npm run dev
   ```
4. **Start Webhook Forwarder**:
   ```bash
   stripe listen --api-key <YOUR_KEY> --forward-to localhost:3000/api/webhooks/stripe
   ```
5. **Test Checkout Flow**: Send `POST http://localhost:3000/api/checkout` in Postman with `{"email": "test@example.com", "name": "Test User"}`. Complete the generated link in Chrome.
6. **Verify Persistence**: Run `docker exec saas_postgres psql -U postgres -d saasdb -c "SELECT * FROM users;"`.
