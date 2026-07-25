import { describe, it, expect } from 'vitest';
import { auditRequestSchema } from '../../../src/modules/audit/validators/url.validator';

describe('URL Validator', () => {
  describe('valid URLs', () => {
    it.each([
      'https://example.com',
      'http://example.com',
      'https://www.google.com',
      'https://example.com/path?q=1#hash',
      'https://sub.domain.co.uk',
      'https://example.com:8080',
      'https://192.0.2.1',
    ])('accepts %s', (url) => {
      const result = auditRequestSchema.safeParse({ url });
      expect(result.success).toBe(true);
    });
  });

  describe('rejects empty / missing url', () => {
    it('rejects empty string', () => {
      const result = auditRequestSchema.safeParse({ url: '' });
      expect(result.success).toBe(false);
    });

    it('rejects missing url field', () => {
      const result = auditRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects null', () => {
      const result = auditRequestSchema.safeParse({ url: null });
      expect(result.success).toBe(false);
    });
  });

  describe('rejects non-http protocols', () => {
    it.each([
      'ftp://example.com',
      'file:///etc/passwd',
      'ssh://example.com',
      'data:text/html,hello',
      'javascript:alert(1)',
    ])('rejects %s', (url) => {
      const result = auditRequestSchema.safeParse({ url });
      expect(result.success).toBe(false);
    });
  });

  describe('rejects localhost and internal hostnames', () => {
    it.each([
      'http://localhost',
      'http://localhost:3000',
      'http://localhost:8080/path',
      'http://0.0.0.0',
      'http://app.local',
      'http://service.internal',
    ])('rejects %s', (url) => {
      const result = auditRequestSchema.safeParse({ url });
      expect(result.success).toBe(false);
    });
  });

  describe('rejects private IP addresses (SSRF protection)', () => {
    it.each([
      'http://10.0.0.1',
      'http://10.255.255.255',
      'http://172.16.0.1',
      'http://172.31.255.255',
      'http://192.168.1.1',
      'http://192.168.255.255',
      'http://127.0.0.1',
      'http://127.255.255.255',
      'http://169.254.169.254',
      'http://100.64.0.1',
    ])('rejects %s', (url) => {
      const result = auditRequestSchema.safeParse({ url });
      expect(result.success).toBe(false);
    });
  });

  describe('rejects malformed URLs', () => {
    it.each([
      'not-a-url',
      'example.com',
      'https://',
      '//example.com',
      'http://[invalid-ipv6]',
    ])('rejects %s', (url) => {
      const result = auditRequestSchema.safeParse({ url });
      expect(result.success).toBe(false);
    });
  });

  describe('error messages', () => {
    it('returns descriptive error for wrong protocol', () => {
      const result = auditRequestSchema.safeParse({ url: 'ftp://example.com' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.errors.map((e) => e.message);
        expect(messages.some((m) => m.toLowerCase().includes('http'))).toBe(true);
      }
    });

    it('returns descriptive error for private IP', () => {
      const result = auditRequestSchema.safeParse({ url: 'http://192.168.1.1' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.errors.map((e) => e.message);
        expect(messages.some((m) => m.toLowerCase().includes('private'))).toBe(true);
      }
    });
  });
});
