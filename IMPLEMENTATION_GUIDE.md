# Implementation Guide: Production-Grade Error Handling

## Quick Start

This guide shows how to add new endpoints following the production-grade error handling pattern.

## 1. Define Your Domain Exceptions

If you need a new error type, extend `DomainException`:

```typescript
// src/common/exceptions/domain.exception.ts
export class CustomException extends DomainException {
  public readonly code = ERROR_CODES.CUSTOM_ERROR;  // Add to constants
  public readonly statusCode = HTTP_STATUS.YOUR_STATUS;

  public constructor(message: string = 'Custom error occurred') {
    super(message);
  }
}
```

Add the error code to constants:
```typescript
// src/common/constants/index.ts
export const ERROR_CODES = {
  // ...existing...
  CUSTOM_ERROR: 'CUSTOM_ERROR',
} as const;

export const HTTP_STATUS = {
  // ...existing...
  YOUR_STATUS: 418,  // Example: I'm a teapot
} as const;
```

## 2. Create Your Service

Services throw domain exceptions. **NO error handling inside services.**

```typescript
// src/modules/myfeature/myfeature.service.ts
@Injectable()
export class MyFeatureService {
  public async doSomething(input: string): Promise<MyResponseDto> {
    // Validate early
    if (!input) {
      throw new InvalidInputException('Input required');
    }

    // Check prerequisites
    if (!this.isReady) {
      throw new ServiceUnavailableException('Database', 'Not connected');
    }

    // Attempt operation
    try {
      const result = await this.database.query(input);
      return { success: true, data: result };
    } catch (err) {
      if (err instanceof TimeoutError) {
        throw new AuditTimeoutException('Database query timeout');
      }
      throw err;  // ← Let GlobalExceptionFilter handle it
    }
  }
}
```

## 3. Create Your Controller

Controllers are **thin HTTP adapters**. No error handling — let exceptions propagate.

```typescript
// src/modules/myfeature/myfeature.controller.ts
@Controller('myfeature')
export class MyFeatureController {
  public constructor(private readonly service: MyFeatureService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  public async execute(
    @Body() body: { input: string },
    @Req() req: Request,
  ): Promise<MyResponseDto> {
    const requestId = (req.headers[CORRELATION_ID_HEADER] as string) ?? '';
    
    // ✓ No try-catch
    // ✓ Just call service and return
    // ✓ Exceptions handled by GlobalExceptionFilter
    return this.service.doSomething(body.input);
  }
}
```

## 4. Define Your DTOs

Response DTOs for success case only:

```typescript
// src/modules/myfeature/dto/myfeature.dto.ts

export interface MyRequestDto {
  input: string;
}

export interface MyResponseDto {
  success: true;
  requestId: string;
  data: {
    result: string;
  };
}

/**
 * Note: Error responses are handled by GlobalExceptionFilter.
 * Never return error objects from controllers.
 */
```

## 5. Add Validation Pipe

Validate input before handler runs:

```typescript
// src/modules/myfeature/validators/input.validator.ts
import { z } from 'zod';

export const myRequestSchema = z.object({
  input: z.string().min(1, 'Input required').max(2000, 'Too long'),
});

// In controller:
@Post()
@UsePipes(new ZodValidationPipe(myRequestSchema))
public async execute(@Body() body: { input: string }) {
  // Input already validated by pipe
}
```

## 6. Register Module

Add your module to the app:

```typescript
// src/app.module.ts
@Module({
  imports: [
    // ...existing...
    MyFeatureModule,
  ],
})
export class AppModule {}
```

## 7. Test Error Scenarios

```typescript
// src/modules/myfeature/myfeature.service.spec.ts
describe('MyFeatureService', () => {
  it('should throw InvalidInputException for empty input', async () => {
    expect(() => service.doSomething('')).toThrow(InvalidInputException);
  });

  it('should throw ServiceUnavailableException when database down', async () => {
    // Mock database as down
    expect(() => service.doSomething('test')).toThrow(ServiceUnavailableException);
  });
});

// src/modules/myfeature/myfeature.controller.spec.ts
describe('MyFeatureController', () => {
  it('should return HTTP 400 for invalid input', async () => {
    const response = await request(app.getHttpServer())
      .post('/myfeature')
      .send({ input: '' });
    
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return HTTP 503 when service unavailable', async () => {
    // Mock service as unavailable
    const response = await request(app.getHttpServer())
      .post('/myfeature')
      .send({ input: 'test' });
    
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
```

## Complete Example: User Registration

### Step 1: Exception
```typescript
// src/common/exceptions/domain.exception.ts
export class UserAlreadyExistsException extends DomainException {
  public readonly code = ERROR_CODES.USER_EXISTS;
  public readonly statusCode = HTTP_STATUS.BAD_REQUEST;

  public constructor(email: string) {
    super(`User with email ${email} already exists`);
  }
}
```

### Step 2: Service
```typescript
// src/modules/auth/auth.service.ts
@Injectable()
export class AuthService {
  public async register(email: string, password: string): Promise<UserDto> {
    // Check if exists
    const existing = await this.userRepository.findByEmail(email);
    if (existing) {
      throw new UserAlreadyExistsException(email);  // ← Throws 400
    }

    // Create user
    const user = await this.userRepository.create({ email, password });
    return { id: user.id, email: user.email };
  }
}
```

### Step 3: Controller
```typescript
// src/modules/auth/auth.controller.ts
@Controller('auth')
export class AuthController {
  @Post('register')
  public async register(
    @Body() body: { email: string; password: string },
  ): Promise<UserDto> {
    // ✓ No try-catch
    // ✓ Let UserAlreadyExistsException propagate
    // ✓ GlobalExceptionFilter converts to HTTP 400
    return this.authService.register(body.email, body.password);
  }
}
```

### Step 4: Test
```typescript
// Returns HTTP 400 with proper error
const response = await request(app.getHttpServer())
  .post('/auth/register')
  .send({ email: 'existing@example.com', password: 'password' });

expect(response.status).toBe(400);
expect(response.body).toEqual({
  success: false,
  requestId: '...',
  error: {
    code: 'USER_EXISTS',
    message: 'User with email existing@example.com already exists',
  },
});
```

## Common Patterns

### Pattern 1: Optional Async Operation
```typescript
try {
  await this.externalService.notify(data);
} catch (err) {
  // Log but don't throw — non-critical operation
  this.logger.warn('Notification failed', err.message);
}
```

### Pattern 2: Conditional Exception
```typescript
if (quantity > MAX_ALLOWED) {
  throw new RateLimitException(`Max ${MAX_ALLOWED} allowed`, 60);
}
```

### Pattern 3: Exception Chaining
```typescript
try {
  await this.database.connect();
} catch (err) {
  throw new ServiceUnavailableException('Database', 'Connection failed');
}
```

### Pattern 4: Validation with Details
```typescript
const blocks = ['localhost', '127.0.0.1', '192.168.'];
if (blocks.some(b => url.includes(b))) {
  throw new BlockedUrlException(
    'Cannot audit private IPs',
    'URL contains blocked address'
  );
}
```

## Debugging

### 1. Check Exception Class
All domain exceptions in `/src/common/exceptions/domain.exception.ts`

### 2. Check GlobalExceptionFilter
```typescript
// src/common/filters/global-exception.filter.ts
// Trace through: classify() → maps to status + code
```

### 3. Test Manually
```bash
curl -X POST http://localhost:3000/api/v1/myendpoint \
  -H "Content-Type: application/json" \
  -d '{"data":"test"}' \
  -w "\nStatus: %{http_code}\n"
```

### 4. Check Logs
```bash
# With request ID
curl -X POST http://localhost:3000/api/v1/myendpoint \
  -H "X-Request-ID: my-request-123" \
  -d '{"data":"test"}'

# Then find in logs:
# grep "my-request-123" logs/app.log
```

## Do's and Don'ts

### ✓ DO
- ✓ Throw domain exceptions from services
- ✓ Let exceptions propagate to GlobalExceptionFilter
- ✓ Validate input early in services
- ✓ Include request ID in logs
- ✓ Return correct HTTP status codes

### ❌ DON'T
- ❌ Return errors with HTTP 200 status
- ❌ Catch and swallow exceptions in services
- ❌ Return error objects from controllers
- ❌ Expose stack traces to clients
- ❌ Add error handling in controllers

## Checklist for New Endpoints

- [ ] Define domain exception (if needed)
- [ ] Create service with business logic (throws exceptions)
- [ ] Create controller (thin, no error handling)
- [ ] Create DTOs (success response only)
- [ ] Add validation pipe for input
- [ ] Write tests for error cases (check HTTP status)
- [ ] Document error codes in ERROR_HANDLING.md
- [ ] Verify correct HTTP status codes returned

## Support

See `ERROR_HANDLING.md` for comprehensive documentation.
