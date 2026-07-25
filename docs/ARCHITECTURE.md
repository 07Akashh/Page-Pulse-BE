# Page Pulse — System Architecture Documentation

## 1. High-Level Architecture

Page Pulse is designed as an event-driven, production-grade URL Auditing microservice using modern Node.js 22, NestJS, BullMQ, and Redis.

```mermaid
graph TD
    Client[Client / Consumer] -->|HTTP POST /api/v1/audit| Gateway[NestJS Gateway / Controller]

    subgraph Middlewares & Security
        Gateway --> Middleware[Correlation ID & Pino Request Logger]
        Middleware --> RateLimitGuard[Redis-backed Rate Limit Guard]
        RateLimitGuard --> ValidationPipe[Zod Validation Pipe]
    end

    subgraph Service Layer
        ValidationPipe --> AuditService[Audit Service]
        AuditService -->|1. Check Cache| AuditRepo[Audit Repository]
        AuditRepo -->|Hit| RedisCache[(Redis Cache)]
        AuditService -->|2. Miss - Dispatch Job| QueueService[BullMQ Queue Service]
    end

    subgraph Worker Pool
        QueueService -->|Push to Queue| RedisQueue[(Redis Queue Store)]
        Worker[Audit Worker / Processor] -->|Pull Job| RedisQueue
        Worker -->|3. HTTP Audit Request| TargetWebsite[External Target URL]
        Worker -->|4. Store Audit Result| AuditRepo
    end
```

---

## 2. Sequence Diagrams

### Audit Request Flow (Cache Miss vs Cache Hit)

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant Middleware as Middleware/Guard
    participant Controller as AuditController
    participant Service as AuditService
    participant Repo as AuditRepository
    participant Queue as QueueService
    participant Worker as AuditProcessor
    participant Target as External Target Website

    Client->>Middleware: POST /api/v1/audit { "url": "https://www.example.com" }
    Middleware->>Middleware: Inject Correlation ID & Check Rate Limit (100 req/hr)
    Middleware->>Controller: Validated Request
    Controller->>Service: auditUrl(url, requestId)
    Service->>Repo: findCachedAudit(url)

    alt Cache Hit
        Repo-->>Service: Return AuditResult from Redis
        Service-->>Controller: { success: true, cached: true, audit: AuditResult }
        Controller-->>Client: 200 OK Response
    else Cache Miss
        Repo-->>Service: null
        Service->>Queue: dispatchAuditJob({ url, requestId })
        Queue-->>Service: jobId (audit:base64url)

        par Async Job Execution
            Queue->>Worker: Pull job from BullMQ
            Worker->>Target: GET https://www.example.com (8s Timeout, Retry, Circuit Breaker)
            Target-->>Worker: HTTP 200 Response HTML & Headers
            Worker->>Worker: Parse Title, Meta Description, Latency, Content Length
            Worker->>Repo: cacheAudit(url, result) (TTL 5 mins)
        and Polling Wait
            loop Poll Cache (Exponential Backoff up to 8s)
                Service->>Repo: findCachedAudit(url)
            end
            Repo-->>Service: Return newly cached AuditResult
        end

        Service-->>Controller: { success: true, cached: false, audit: AuditResult }
        Controller-->>Client: 200 OK Response
    end
```

---

## 3. Data Flow Diagrams

### Queue Flow & Deduplication

```mermaid
flowgraph LR
    A[Incoming Request: URL] --> B{Calculate Deterministic JobId}
    B --> C["jobId = audit:base64(url)"]
    C --> D{BullMQ Enqueue}
    D -->|New JobId| E[Added to Waiting Queue]
    D -->|Existing Active JobId| F[Deduplicated - Reuses Existing Job]
    E --> G[Worker Pool - Concurrency: 20]
    G --> H[Process HTTP Fetch]
    H --> I[Write Result to Redis Key: cache:audit:hash]
```

### Cache Flow

```mermaid
flowgraph TD
    A[URL Key Request] --> B[Redis Key: cache:audit:<base64url>]
    B -->|EXISTS| C[Deserialize JSON]
    C --> D[Increment Cache Hit Metric]
    D --> E[Return Audit Object]
    B -->|NOT EXISTS| F[Increment Cache Miss Metric]
    F --> G[Dispatch BullMQ Worker]
    G --> H[Fetch & Cache Result with EXPIRE TTL]
```

---

## 4. Deployment Diagram

```mermaid
graph TB
    subgraph Container Host / Kubernetes
        subgraph Ingress Layer
            ALB[Application Load Balancer / Nginx]
        end

        subgraph App Containers (Blue/Green Deployment)
            App1[Page Pulse Container 1]
            App2[Page Pulse Container 2]
        end

        subgraph Infrastructure
            Redis[(Redis 7 Cluster / Standalone)]
        end
    end

    ALB -->|Port 3000| App1
    ALB -->|Port 3000| App2
    App1 -->|Port 6379| Redis
    App2 -->|Port 6379| Redis
```

---

## 5. Technology Decision Records (TDR)

### TDR-001: NestJS Framework Selection

- **Selected**: NestJS
- **Alternative Considered**: Express.js, Fastify
- **Reason for Selection**: NestJS provides an enterprise-grade modular architecture, native Dependency Injection, clean separation of concerns, and built-in support for guards, filters, pipes, and microservice modules. Fastify and Express require writing custom architectural boilerplate.

### TDR-002: BullMQ Queue Engine

- **Selected**: BullMQ
- **Alternative Considered**: Bull (v3), AWS SQS, Raw Redis RPUSH/LPOP
- **Reason for Selection**: BullMQ is built for Node.js on top of Redis streams/hashes. It natively supports worker concurrency control, exponential backoff retries, job deduplication via custom `jobId`, dead-letter queues, and automatic cleanup of completed jobs. Raw Redis lacks retry semantics and concurrency controls.

### TDR-003: Zod Validation Engine

- **Selected**: Zod
- **Alternative Considered**: class-validator, Joi
- **Reason for Selection**: Zod guarantees runtime type safety, schema composability, zero-dependency lightweight execution, and seamless TypeScript type inference without relying on experimental metadata reflection decorators (`reflect-metadata`).

### TDR-004: Pino Structured Logger

- **Selected**: Pino
- **Alternative Considered**: Winston, Morgan
- **Reason for Selection**: Pino is up to 5x faster than Winston, produces JSON-first structured logs natively, supports stream redaction for sensitive fields (auth headers, cookies), and integrates directly with `pino-http` for request logging.

### TDR-005: Redis Storage Strategy

- **Selected**: Redis 7
- **Alternative Considered**: Memcached, In-Memory Node Map
- **Reason for Selection**: Redis serves as a multi-purpose infrastructure backbone: backing BullMQ queues, providing atomic rate limiting counters via `INCR`/`EXPIRE`, and caching audit results. In-memory maps do not survive restarts or scale horizontally across multiple container instances.
