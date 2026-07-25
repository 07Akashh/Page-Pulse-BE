# Page Pulse — Failure Analysis, Observability & Rollback Guide

## 1. Failure Analysis & Mitigations

| Failure Scenario | Root Cause | Impact | Mitigation Strategy |
|---|---|---|---|
| **Redis Outage** | Memory exhaustion, network partition, or Redis server crash. | Cache reads fail, rate limiter fails, queue dispatch fails. | **1. Fail-open Guard:** Rate limiter fails open so API remains accessible.<br>**2. Circuit Breaker:** Gracefully bypasses cache on Redis error.<br>**3. Connection Backoff:** `ioredis` retries with exponential backoff up to 10 attempts. |
| **Queue Overflow** | Sudden spike in external URL audit requests exceeding processing capacity. | Memory bloat and high latency for waiting jobs. | **1. Backpressure Guard:** Service checks `getWaitingCount()`. If > `QUEUE_MAX_SIZE` (500), returns structured HTTP `429 QUEUE_FULL`.<br>**2. Deduplication:** Duplicate URL audit requests share the same `jobId` to avoid queue flooding. |
| **Slow Target Website** | Target website takes > 10s or hangs indefinitely (tarpit attack). | Worker thread starvation and high latency. | **1. Configurable Timeout:** `httpFetch` enforces strict `AbortController` timeout (default 8s).<br>**2. Per-Host Circuit Breaker:** If a domain fails 5 times within 60s, circuit opens to fail fast for subsequent requests. |
| **Worker Crash** | Out-of-Memory (OOM) or unhandled error inside worker. | Job terminated mid-execution. | **1. BullMQ Auto-Retry:** Failed jobs are retried up to 3 times with exponential backoff (1s, 2s, 4s).<br>**2. Process Isolation:** Worker runs inside NestJS async task handling loop; crashes don't crash main HTTP server. |
| **Memory Leak** | Large response bodies or unbounded log buffers retained in heap. | Node.js process RSS memory grows until OOM kill. | **1. Text Truncation:** HTML body parsing extracts title/description and releases raw body strings.<br>**2. Job Pruning:** BullMQ configured to auto-remove completed jobs (`removeOnComplete: 1000`).<br>**3. Pino Stream:** Log output streams directly to stdout without in-memory buffering. |
| **Rate Limit Abuse** | Malicious bot originating from single IP sending 1000s of requests. | Denied service for legitimate users. | **1. Redis Sliding Window:** `RateLimitGuard` enforces max 100 req/hour per IP with `Retry-After` header.<br>**2. Correlation ID Tracking:** IP and Request ID logged for upstream WAF/Cloudflare IP banning. |
| **Deployment Failure** | Broken code or missing env variable deployed to production. | Service crashes on start or returns 500 errors. | **1. Startup Schema Validation:** Zod validates all env variables on bootstrap and fails fast before listening.<br>**2. Kubernetes Readiness Probe:** `/ready` probe returns 503 if Redis/Queue is unreachable, preventing traffic shift. |

---

## 2. Observability & Monitoring

The service exposes Prometheus metrics at `/metrics`. 

### Key Alert Thresholds

| Metric | Prometheus Metric Name | Alert Threshold | Severity | Recommended Action |
|---|---|---|---|---|
| **Latency P95** | `pagepulse_http_request_duration_ms_bucket` | > 3000ms over 5m | Warning | Check worker pool concurrency and external DNS latency. |
| **Queue Depth** | `pagepulse_queue_waiting` | > 100 jobs for > 3m | High | Scale up worker replica count horizontally. |
| **Redis Health** | `pagepulse_node_process_resident_memory_bytes` / `/ready` | `/ready` fails 3x | Critical | Check Redis server health and memory usage. |
| **Memory RSS** | `process_resident_memory_bytes` | > 512 MB | High | Inspect heap snapshot for memory leak; restart container. |
| **CPU Event Loop Lag**| `pagepulse_node_eventloop_lag_seconds` | > 100ms | Warning | Check for synchronous blocking operations in handlers. |
| **Cache Hit Ratio** | `pagepulse_audit_cache_hits_total` / Total | < 20% over 1h | Info | Evaluate if `CACHE_TTL` (5 mins) should be increased. |
| **Audit Timeouts** | `pagepulse_audit_timeouts_total` | > 5% of requests | High | Check external connectivity and outbound network firewall. |
| **HTTP 5xx Rate** | `pagepulse_http_requests_total{status_code=~"5.."}` | > 1% of total | Critical | Inspect Pino error logs for unhandled exception stack traces. |

---

## 3. Rollback & Deployment Strategy

### Blue / Green Deployment Strategy

```
Step 1: Deploy Green (v2) alongside Blue (v1)
--------------------------------------------------
[Traffic] ---> [ Load Balancer / Ingress Router ]
                     |
                     +---> [ Blue (v1) - Live ]
                     |
                     +---> [ Green (v2) - Staging ]
                            |
                            v
                       GET /ready (Health Check)

Step 2: Automated Readiness Check
--------------------------------------------------
Green (v2) runs self-diagnostics:
- Redis PING check
- Queue connectivity
- Environment variable validation

Step 3: Traffic Switch or Rollback
--------------------------------------------------
IF /ready returns 200 OK:
  Load Balancer shifts 100% traffic to Green (v2).
  Blue (v1) is terminated after 30-second connection draining.

IF /ready returns 503 Service Unavailable OR 5xx error rate > 0.5%:
  Load Balancer immediately rolls back traffic 100% to Blue (v1).
  Green (v2) deployment is aborted automatically.
```

### Feature Flag Mitigation
For high-risk changes (e.g. changing timeout algorithms or worker concurrency), configuration options are bound to dynamic environment variables (`REQUEST_TIMEOUT`, `QUEUE_CONCURRENCY`) allowing live tuning without requiring full binary redeployments.
