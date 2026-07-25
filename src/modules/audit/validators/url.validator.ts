import { z } from 'zod';
import { isPrivateIpv4, isPrivateIpv6 } from '../../../common/utils/ip.util';

/**
 * Zod schema for the audit request URL.
 *
 * Validation rules (ordered by specificity):
 * 1. Must be a non-empty string
 * 2. Must be a valid URL (parseable by the URL constructor)
 * 3. Protocol must be http or https only (blocks ftp://, file://, etc.)
 * 4. Hostname must not be 'localhost' or '127.0.0.1' style loopback
 * 5. Hostname must not resolve to a private/reserved IP range
 *
 * Note: DNS-based SSRF (attacker registers attacker.com → 10.0.0.1) is mitigated
 * at the worker level via a post-DNS resolution check. This schema handles
 * the easy/obvious cases at validation time.
 */
export const auditUrlSchema = z
  .string({ required_error: 'url is required' })
  .min(1, 'url must not be empty')
  .refine(
    (val) => {
      try {
        new URL(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'url must be a valid URL (e.g. https://www.example.com)' },
  )
  .refine(
    (val) => {
      try {
        const { protocol } = new URL(val);
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'url must use http or https protocol' },
  )
  .refine(
    (val) => {
      try {
        const { hostname } = new URL(val);
        return (
          hostname !== 'localhost' &&
          hostname !== '0.0.0.0' &&
          !hostname.endsWith('.local') &&
          !hostname.endsWith('.internal')
        );
      } catch {
        return false;
      }
    },
    { message: 'url must not target localhost or internal hostnames' },
  )
  .refine(
    (val) => {
      try {
        const { hostname } = new URL(val);
        // Block direct IP targets that are private
        return !isPrivateIpv4(hostname) && !isPrivateIpv6(hostname);
      } catch {
        return false;
      }
    },
    { message: 'url must not target private or reserved IP addresses' },
  );

export const auditRequestSchema = z.object({
  url: auditUrlSchema,
});

export type AuditRequestDto = z.infer<typeof auditRequestSchema>;
