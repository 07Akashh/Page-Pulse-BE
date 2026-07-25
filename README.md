# Page Pulse — URL Audit Service

> Production-ready, enterprise-grade URL Audit Service built with NestJS, TypeScript, Node 22, Redis, BullMQ, Pino, Zod, and Vitest.

[![CI Status](https://github.com/your-org/page-pulse/workflows/Page%20Pulse%20CI/badge.svg)](https://github.com/your-org/page-pulse/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node: >=22.0.0](https://img.shields.io/badge/Node--js->=22.0.0-green.svg)](https://nodejs.org/)

---

## 📖 Overview

**Page Pulse** is an automated URL inspection microservice designed for high throughput, strict security, and operational reliability. Given any public HTTP/HTTPS URL, Page Pulse audits the target page and returns real-time metrics including page title, meta description, status code, response latency, content length, response headers, SSL status, and reachability.

### Core Features

- 🏗️ **NestJS Modular Architecture**: Domain-driven feature modules (`audit`, `health`, `metrics`) separated from cross-cutting concerns (`cache`, `logger`, `queue`, `config`).
- ⚡ **Asynchronous Worker Queue**: Powered by BullMQ with concurrency control (max 20 concurrent external HTTP audits) and backpressure protection.
- 🛡️ **SSRF Security & URL Validation**: Zod schema validation blocking `file://`, `ftp://`, `localhost`, link-local addresses, and RFC 1918 private IPv4/IPv6 ranges.
- ⏱️ **Request Timeout & Resiliency**: Configurable 8-second HTTP request timeouts (`AbortController`), exponential backoff retries, and per-host **Circuit Breakers**.
- 🚀 **Redis-backed Caching**: 5-minute configurable TTL for audit results; instant cache hits returning `cached: true`.
- 🔒 **IP Rate Limiting**: Redis-backed sliding window rate limiter (100 requests/hour per IP) with standard RFC 6585 headers (`X-RateLimit-*`, `Retry-After`).
- 🆔 **Correlation IDs & JSON Logging**: UUID `x-request-id` propagation across all requests, outputs structured JSON logs via Pino.
- 📊 **Prometheus Metrics & Health Checks**: `/metrics` endpoint for Prometheus scraping, plus `/health` (liveness) and `/ready` (readiness) endpoints.
- 🐳 **Docker Containerized**: Multi-stage `Dockerfile` and `docker-compose.yml` with Redis container and automated health checks.

---

## 🏛️ System Architecture

```
HTTP Request (POST /api/v1/audit)
       │
       ▼
[ CorrelationIdMiddleware ]    ──▶ Injects / propagates x-request-id
       │
       ▼
[ RateLimitGuard ]             ──▶ Checks Redis sliding window (100 req/hr)
       │
       ▼
[ ZodValidationPipe ]          ──▶ Validates URL format & SSRF rules
       │
       ▼
[ AuditController ]            ──▶ Delegates to AuditService
       │
       ▼
[ AuditService ]
   ├──▶ 1. [ AuditRepository ] ──▶ Check Redis Cache (cache:audit:<hash>)
   │        │
   │        ├── (Hit)  ──▶ Return cached AuditResult (cached: true)
   │        └── (Miss) ──▶ Dispatch to QueueService
   │
   └──▶ 2. [ QueueService ]    ──▶ Enqueue job in BullMQ (jobId deduplication)
                 │
                 ▼
          [ AuditProcessor ]   ──▶ Worker Pool (Concurrency: 20)
                 │
                 ├──▶ httpFetch (8s Timeout, Retry, Circuit Breaker)
                 └──▶ Persist result in Redis Cache
```

For complete diagrams (sequence, data flow, TDRs), see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 🛠️ Tech Stack

| Component | Technology | Rationale |
|---|---|---|
| **Framework** | NestJS + Node 22 | Enterprise dependency injection & modular feature architecture. |
| **Language** | TypeScript (Strict mode) | Compile-time safety and self-documenting code contracts. |
| **Database & Cache** | Redis 7 + `ioredis` | Ultra-fast caching, atomic rate limit counters, and queue backing. |
| **Queue** | BullMQ | Reliable async job queue with concurrency limits & retries. |
| **Validation** | Zod | Runtime schema validation with TypeScript type inference. |
| **Logging** | Pino + `pino-http` | JSON-first structured logging (~5x faster than Winston). |
| **Testing** | Vitest + Supertest | Blazing fast unit & end-to-end integration tests. |
| **Documentation** | OpenAPI / Swagger | Interactive API docs generated at `/api/docs`. |
| **Containerization** | Docker + Docker Compose | Portable multi-stage build running non-root containers. |

---

## 📁 Project Structure

```
page-pulse/
├── src/
│   ├── app.module.ts                    # Root module
│   ├── main.ts                          # App bootstrap & security configuration
│   ├── modules/                         # Domain Feature Modules
│   │   ├── audit/                       # Audit Domain
│   │   │   ├── audit.module.ts
│   │   │   ├── audit.controller.ts      # HTTP controller (/api/v1/audit)
│   │   │   ├── audit.service.ts         # Orchestration & cache-check logic
│   │   │   ├── audit.repository.ts      # Redis write-through repository
│   │   │   ├── audit.processor.ts       # BullMQ worker (HTTP fetcher)
│   │   │   ├── dto/                     # Data transfer objects
│   │   │   ├── validators/              # Zod URL validation & SSRF rules
│   │   │   └── interfaces/              # Repository interfaces
│   │   ├── health/                      # Health & Readiness (/health, /ready)
│   │   └── metrics/                     # Prometheus Metrics (/metrics)
│   ├── shared/                          # Cross-Cutting Global Modules
│   │   ├── cache/                       # Redis Cache Service
│   │   ├── config/                      # Zod Environment Config Validation
│   │   ├── logger/                      # Pino Logger Service
│   │   └── queue/                       # BullMQ Queue Service
│   └── common/                          # Framework Infrastructure
│       ├── constants/                   # Error codes & key definitions
│       ├── filters/                     # Global Exception Filter
│       ├── guards/                      # Rate Limit Guard & Zod Pipe
│       ├── middlewares/                 # Correlation ID Middleware
│       ├── types/                       # Shared TypeScript Interfaces
│       └── utils/                       # Circuit Breaker & HTTP Client
├── test/                                # Test Suites
│   ├── unit/                            # Unit tests (Vitest)
│   └── e2e/                             # End-to-end integration tests
├── docs/                                # Architecture & Operational Docs
│   ├── ARCHITECTURE.md
│   └── FAILURE_ANALYSIS.md
├── Dockerfile                           # Production multi-stage Docker build
├── docker-compose.yml                   # Compose stack with Redis 7
├── .env.example                         # Environment configuration template
└── README.md
```

---

## ⚙️ Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Environment mode (`development`, `test`, `production`). |
| `PORT` | `3000` | HTTP port for the application server. |
| `REDIS_URL` | `redis://localhost:6379` | Full Redis connection URL. |
| `CACHE_TTL` | `300` | Audit result cache time-to-live in seconds (5 mins). |
| `RATE_LIMIT_MAX` | `100` | Max request count per IP window. |
| `RATE_LIMIT_WINDOW_MS` | `3600000` | Rate limit window in milliseconds (1 hour). |
| `QUEUE_CONCURRENCY` | `20` | Max concurrent external HTTP audit worker jobs. |
| `QUEUE_MAX_SIZE` | `500` | Max waiting jobs in queue before returning HTTP 429. |
| `REQUEST_TIMEOUT` | `8000` | Target URL request timeout in milliseconds (8 seconds). |
| `REQUEST_MAX_RETRIES` | `3` | Max HTTP retry attempts for external requests. |
| `LOG_LEVEL` | `info` | Pino log level (`trace`, `debug`, `info`, `warn`, `error`). |

---

## 🚀 Quick Start (Local Run)

### Prerequisites

- **Node.js**: >= 22.0.0
- **Docker**: Docker Desktop or Docker Engine + Compose
- **Redis**: Local instance or via Docker

### 1. Start Redis

```bash
docker run -d --name page-pulse-redis -p 6379:6379 redis:7-alpine
```

### 2. Install & Configure

```bash
# Clone the repository
git clone https://github.com/your-org/page-pulse.git
cd page-pulse

# Copy environment variables
cp .env.example .env

# Install dependencies
npm install
```

### 3. Run Development Server

```bash
npm run start:dev
```

The server will start at `http://localhost:3000`.  
Swagger documentation is available at `http://localhost:3000/api/docs`.

---

## 🐳 Docker Deployment

To launch the full stack (API + Redis) via Docker Compose:

```bash
docker-compose up -d --build
```

Check service status:

```bash
docker-compose ps
```

Stop the stack:

```bash
docker-compose down -v
```

---

## 📡 API Documentation & Examples

### 1. Audit a URL

**Request:**

```bash
POST /api/v1/audit
Content-Type: application/json
x-request-id: 550e8400-e29b-41d4-a716-446655440000

{
  "url": "https://example.com"
}
```

**Response (200 OK — Live Audit):**

```json
{
  "success": true,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "cached": false,
  "audit": {
    "title": "Example Domain",
    "description": "",
    "statusCode": 200,
    "responseTime": 320,
    "contentLength": 1256,
    "headers": {
      "content-type": "text/html; charset=UTF-8",
      "cache-control": "max-age=604800"
    },
    "https": true,
    "reachable": true
  }
}
```

**Response (200 OK — Cached):**

```json
{
  "success": true,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "cached": true,
  "audit": {
    "title": "Example Domain",
    "description": "",
    "statusCode": 200,
    "responseTime": 320,
    "contentLength": 1256,
    "headers": {
      "content-type": "text/html; charset=UTF-8"
    },
    "https": true,
    "reachable": true
  }
}
```

### 2. Invalid Request Error (400 Bad Request)

**Request:**

```bash
POST /api/v1/audit
Content-Type: application/json

{
  "url": "http://169.254.169.254"
}
```

**Response (400 Bad Request):**

```json
{
  "success": false,
  "requestId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [
      {
        "field": "url",
        "message": "url must not target private or reserved IP addresses"
      }
    ]
  }
}
```

### 3. Health & Readiness Endpoints

```bash
# Liveness probe
GET /health
# Response: { "status": "ok", "timestamp": "2026-07-25T12:00:00.000Z" }

# Readiness probe (Checks Redis, Queue, Memory)
GET /ready
# Response (200 OK):
{
  "status": "ok",
  "timestamp": "2026-07-25T12:00:00.000Z",
  "uptime": 3600,
  "checks": {
    "redis": { "status": "ok", "latencyMs": 2 },
    "queue": { "status": "ok", "detail": "waiting=0 active=0" },
    "memory": { "status": "ok", "detail": "rss=85MB heap=42/65MB" }
  }
}
```

### 4. Metrics Endpoint

```bash
GET /metrics
# Returns Prometheus formatted metrics (http_requests_total, queue_waiting, audit_duration_ms, etc.)
```

---

## 🧪 Testing

The repository uses **Vitest** for fast unit testing and **Supertest** for E2E integration testing.

```bash
# Run unit tests
npm run test

# Run unit tests with code coverage (Target >= 90%)
npm run test:cov

# Run E2E integration tests
npm run test:e2e

# Run linter & type checker
npm run lint:check
npm run type-check
```

---

## 🔄 CI/CD Pipeline

On every push and pull request, GitHub Actions (`.github/workflows/ci.yml`) automatically executes:
1. Code formatting check (`prettier`)
2. ESLint verification (`eslint`)
3. TypeScript type checking (`tsc --noEmit`)
4. Vitest Unit & Coverage Suite (`npm run test:cov`)
5. Production build test (`nest build`)
6. Docker image build verification

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
