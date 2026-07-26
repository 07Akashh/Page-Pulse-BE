# HTTP Status Code Fix - Complete Solution

## Problem Identified

Your API was returning **ALL responses with HTTP 200 status code**, including errors. This was caused by:

1. **`@HttpCode(HttpStatus.OK)` decorator** in the audit controller forcing HTTP 200 on all responses
2. **Missing GlobalExceptionFilter registration** in main.ts - the filter existed but was never activated

## Example of the Bug

```javascript
// BEFORE (broken)
Request: POST /api/v1/audit
Response: HTTP 200 OK  ← WRONG! Should be 504 for timeout
{
  "success": false,
  "requestId": "",
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "Audit for https://www.vidyasethu.com did not complete within 18000ms"
  }
}

// AFTER (fixed)
Request: POST /api/v1/audit
Response: HTTP 504 Gateway Timeout  ← CORRECT!
{
  "success": false,
  "requestId": "",
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "Audit for https://www.vidyasethu.com did not complete within 10000ms"
  }
}
```

## What Was Fixed

### 1. Removed HttpCode Decorator
**File:** `src/modules/audit/audit.controller.ts`
```typescript
// BEFORE
@Post()
@HttpCode(HttpStatus.OK)  ← Removed this line
@UsePipes(new ZodValidationPipe(auditRequestSchema))

// AFTER
@Post()
@UsePipes(new ZodValidationPipe(auditRequestSchema))
```

### 2. Registered GlobalExceptionFilter
**File:** `src/main.ts`
```typescript
// Added after creating the app:
app.useGlobalFilters(new GlobalExceptionFilter(loggerService));
```

## HTTP Status Codes Now Returned

| Scenario | Status Code | Error Code |
|----------|------------|-----------|
| Success | **200 OK** | (no error) |
| Queue full | **429 Too Many Requests** | QUEUE_FULL |
| Timeout | **504 Gateway Timeout** | REQUEST_TIMEOUT |
| Invalid URL | **400 Bad Request** | VALIDATION_ERROR |
| Rate limited | **429 Too Many Requests** | RATE_LIMIT_EXCEEDED |
| Blocked URL | **400 Bad Request** | BLOCKED_URL |
| Server error | **500 Internal Server Error** | INTERNAL_ERROR |

## Why This Matters

1. **Client Retry Logic** - Clients can now detect retryable errors (429, 504) vs permanent errors (400, 500)
2. **HTTP Semantics** - API follows REST conventions; status codes have meaning
3. **Debugging** - No more confusion: if status is 200, the request succeeded
4. **Production Ready** - This is standard practice for all APIs

## Testing the Fix

Test the timeout scenario:
```bash
curl -X POST http://localhost:3000/api/v1/audit \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.example.com"}' \
  -w "\nStatus: %{http_code}\n"
```

- **Success**: Should see `HTTP 200` with audit data
- **Timeout**: Should see `HTTP 504` with error message (NOT 200)
- **Queue Full**: Should see `HTTP 429` (NOT 200)

## Architecture Now

```
Request
  ↓
Controller (thin adapter)
  ↓
Service (throws exceptions)
  ↓
Exception thrown ← NEW: Caught by GlobalExceptionFilter
  ↓
GlobalExceptionFilter
  ├─ DomainException? → Set correct status code
  ├─ HttpException? → Set correct status code
  └─ Unknown error? → HTTP 500
  ↓
Format response with proper status code
  ↓
Response sent to client
```

## Files Changed

- `src/modules/audit/audit.controller.ts` - Removed @HttpCode decorator
- `src/main.ts` - Registered GlobalExceptionFilter
- `src/common/filters/global-exception.filter.ts` - (already existed, now active)
- `src/common/exceptions/domain.exception.ts` - (already existed, now properly used)
