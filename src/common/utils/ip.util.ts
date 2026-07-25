/**
 * Utilities for IP address classification.
 *
 * Used by the URL validator to block requests to private/loopback/link-local addresses.
 * This is a security control — without it, the service could be used as an SSRF proxy
 * to reach internal services (169.254.x.x = EC2 metadata, 10.x.x.x = VPCs, etc.)
 */

/** CIDR ranges that must never be requested externally */
const PRIVATE_CIDR_RANGES = [
  // Loopback
  { prefix: [127], mask: 8 },
  // RFC 1918 private ranges
  { prefix: [10], mask: 8 },
  { prefix: [172, 16], mask: 12 },
  { prefix: [192, 168], mask: 16 },
  // Link-local (APIPA, AWS metadata: 169.254.169.254)
  { prefix: [169, 254], mask: 16 },
  // Carrier-grade NAT
  { prefix: [100, 64], mask: 10 },
  // Multicast
  { prefix: [224], mask: 4 },
  // Reserved / broadcast
  { prefix: [240], mask: 4 },
] as const;

/**
 * Returns true if the given IPv4 string is a private/reserved address.
 */
export function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false; // Not a valid IPv4 — let other validation handle it
  }

  for (const range of PRIVATE_CIDR_RANGES) {
    if (matchesCidr(parts, range.prefix as unknown as number[], range.mask)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns true if an IPv6 address is loopback or link-local.
 */
export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return (
    normalized === '::1' ||           // loopback
    normalized.startsWith('fe80:') || // link-local
    normalized.startsWith('fc') ||    // unique local
    normalized.startsWith('fd')       // unique local
  );
}

function matchesCidr(ip: number[], prefix: number[], mask: number): boolean {
  const ipNum = ipToNumber(ip);
  const prefixNum = ipToNumber([...prefix, ...Array(4 - prefix.length).fill(0)]);
  const maskNum = (~0 << (32 - mask)) >>> 0;
  return (ipNum & maskNum) === (prefixNum & maskNum);
}

function ipToNumber(parts: number[]): number {
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}
