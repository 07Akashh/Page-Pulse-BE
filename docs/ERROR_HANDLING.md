# Production-Grade Error Handling

## Overview

This document outlines the error handling architecture across the Page Pulse API. The system ensures that:

1. **HTTP status codes accurately reflect error types** — no 200 OK responses for errors
2. **Structured error responses** — consistent format across all endpoints
3. **Proper separation of concerns** — controllers, services, and exception filters
4. **Production-level resilience** — comprehensive logging and tracing
5. **Security** — no stack traces or internal details leaked to clients

## Error Flow

```
User Request
    ↓
Controller (HTTP Adapter Layer)
    ↓ 
Service (Business Logic)
    ├─ Throws: QueueFullException (429)
    ├─ Throws: AuditTimeoutException (504)
    ├─ Throws: RateLimitException (429)
    └─ Throws: ServiceUnavailableException (503)
    ↓
GlobalExceptionFilter (Central Exception Handler)
    ├─ Catches DomainException
    ├─ Catches HttpException
    ├─ Catches Unknown Errors
    ├─ Maps to HTTP status code
    └─ Formats structured response
    ↓
Client (with correct HTTP status)
```

## Exception Types

### Domain Exceptions

All business logic errors extend `DomainException` and automatically map to HTTP status codes.

#### QueueFullException (HTTP 429)
```typescript
throw new QueueFullException('Audit queue is full. Please retry shortly.');
```
- Audit queue has reached capacity
- Client should retry after delay
- Indicates system overload

#### AuditTimeoutException (HTTP 504)
```typescript
throw new AuditTimeoutException('Audit did not complete within 10000ms');
```
- Audit request exceeded timeout
- Website may be slow or unreachable
- Client may retry with backoff

#### RateLimitException (HTTP 429)
```typescript
throw new RateLimitException('Rate limit exceeded', 60);
```
- Client has exceeded rate limit
- Includes optional `retryAfterSeconds`
- Prevents abuse

#### InvalidUrlException (HTTP 400)
```typescript
throw new InvalidUrlException('URL must be valid HTTP(S) format');
```
- Input validation failed
- Client error — cannot retry same request
- User must fix input

#### BlockedUrlException (HTTP 400)
```typescript
throw new BlockedUrlException('Cannot audit localhost', 'Private IP');
```
- URL blocked for security/policy reasons
- Includes reason in error details
- Examples: localhost, 127.0.0.1, private IPs

#### ServiceUnavailableException (HTTP 503)
```typescript
throw new ServiceUnavailableException('Redis', 'Internal dependency unavailable');
```
- External service dependency down (Redis, database)
- Client should retry with exponential backoff
- Implies temporary issue

#### AuditFailedException (HTTP 500)
```typescript
throw new AuditFailedException('Network timeout reaching example.com');
```
- Audit execution failed unexpectedly
- Internal server error
- Retry may help

## Response Format

### Success Response
```json
{
  "success": true,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "cached": false,
  "audit": {
    "title": "Example Domain",
    "statusCode": 200,
    "responseTime": 320,
    ...
  }
}
```

### Error Response
```json
{
  "success": false,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "error": {
    "code": "QUEUE_FULL",
    "message": "Audit queue is at capacity. Please retry shortly.",
    "details": null
  }
}
```

### Error with Details
```json
{
  "success": false,
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "error": {
    "code": "BLOCKED_URL",
    "message": "This URL cannot be audited.",
    "details": {
      "reason": "Private IP address"
    }
  }
}
```

## HTTP Status Codes

| Exception | Code | Status | Meaning |
|-----------|------|--------|---------|
| QueueFullException | QUEUE_FULL | 429 | Too Many Requests |
| RateLimitException | RATE_LIMIT_EXCEEDED | 429 | Too Many Requests |
| AuditTimeoutException | REQUEST_TIMEOUT | 504 | Gateway Timeout |
| InvalidUrlException | VALIDATION_ERROR | 400 | Bad Request |
| BlockedUrlException | URL_BLOCKED | 400 | Bad Request |
| ServiceUnavailableException | SERVICE_UNAVAILABLE | 503 | Service Unavailable |
| AuditFailedException | AUDIT_FAILED | 500 | Internal Server Error |
| Unknown Error | INTERNAL_ERROR | 500 | Internal Server Error |

## Controller Pattern

Controllers are **thin HTTP adapters** with NO error handling:

```typescript
@Controller('audit')
export class AuditController {
  @Post()
  public async audit(@Body() body: { url: string }): Promise<AuditResponseDto> {
    // ✓ Just call service and return result
    // ✓ No try-catch blocks
    // ✓ Let exceptions propagate to GlobalExceptionFilter
    return this.auditService.auditUrl(body.url, requestId);
  }
}
```

**Why?** Eliminates duplicate error handling logic. Exceptions are caught centrally by GlobalExceptionFilter.

## Service Pattern

Services **throw domain exceptions**:

```typescript
@Injectable()
export class AuditService {
  public async auditUrl(url: string, requestId: string): Promise<AuditResponseDto> {
    // Throw domain exceptions with correct error code + HTTP status
    if (!jobId) {
      throw new QueueFullException();
    }
    
    if (!result) {
      throw new AuditTimeoutException();
    }

    return { success: true, ... };
  }
}
```

## GlobalExceptionFilter

Central exception handler converts ANY exception to structured response:

```typescript
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  public catch(exception: unknown, host: ArgumentsHost): void {
    // 1. Classify exception type
    if (exception instanceof DomainException) {
      status = exception.statusCode;
      code = exception.code;
    }
    
    // 2. Log full context (stack trace, internals)
    this.logger.error(`Error: ${message}`, stack);
    
    // 3. Send structured response (no internals)
    res.status(status).json({
      success: false,
      requestId,
      error: { code, message }
    });
  }
}
```

## Client Retry Logic

Clients should implement retry logic based on HTTP status:

```typescript
// 429: Too Many Requests → Exponential backoff
if (response.status === 429) {
  await sleep(Math.exp(attemptCount) * 1000);
  retry();
}

// 504: Gateway Timeout → Exponential backoff
if (response.status === 504) {
  await sleep(Math.exp(attemptCount) * 1000);
  retry();
}

// 503: Service Unavailable → Exponential backoff
if (response.status === 503) {
  await sleep(Math.exp(attemptCount) * 1000);
  retry();
}

// 400: Bad Request → Do NOT retry
if (response.status === 400) {
  handleUserError(response.body.error.message);
}

// 500: Internal Error → Single retry
if (response.status === 500) {
  await sleep(2000);
  retry();
}
```

## Security

The error handling system ensures:

1. **No stack traces** in response bodies
2. **No internal paths** (file paths, DB queries) leaked
3. **No sensitive config** (API keys, IPs) exposed
4. **Full stack traces** logged internally for debugging
5. **Request ID correlation** for tracing across logs

## Testing Error Scenarios

```typescript
// Test QueueFullException → 429
expect(response.status).toBe(429);
expect(response.body.error.code).toBe('QUEUE_FULL');

// Test InvalidUrlException → 400
expect(response.status).toBe(400);
expect(response.body.error.code).toBe('VALIDATION_ERROR');

// Test Unknown Error → 500
expect(response.status).toBe(500);
expect(response.body.error.code).toBe('INTERNAL_ERROR');
```

## Migration Guide

If refactoring existing code:

### Before (❌ Bad)
```typescript
// 1. Error handling in controller
@Post()
public async audit(@Body() body): Promise<AuditResponseDto | AuditErrorResponseDto> {
  try {
    return await this.service.audit(body.url);
  } catch (err) {
    return { success: false, error: { code: 'ERROR' } }; // ❌ 200 status!
  }
}
```

### After (✓ Good)
```typescript
// 1. No error handling in controller
@Post()
public async audit(@Body() body): Promise<AuditResponseDto> {
  return this.service.audit(body.url); // ✓ Exceptions propagate
}

// 2. Throw domain exceptions in service
public async audit(url: string): Promise<AuditResponseDto> {
  if (!jobId) {
    throw new QueueFullException(); // ✓ Correct HTTP 429
  }
  return { success: true, ... };
}

// 3. GlobalExceptionFilter handles it
// Automatically converts to:
// HTTP 429 with { success: false, error: { code: 'QUEUE_FULL' } }
```

## Monitoring & Alerting

Monitor these error rates:

- **429 (Too Many Requests)** — Rate limiting working, check load
- **504 (Gateway Timeout)** — Slow audit targets, check network
- **503 (Service Unavailable)** — Dependency issues (Redis, DB)
- **500 (Internal Error)** — Bugs, requires investigation
- **400 (Bad Request)** — User input errors, validate early

Alert on:
- Error rate > 5% of total requests
- 503 errors (dependency down)
- Sustained 504 errors (performance degradation)
