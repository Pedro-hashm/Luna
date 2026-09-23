import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';

const LOCAL_HOST_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'test',
  'invalid',
];

export class UnsafeWebUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeWebUrlError';
  }
}

export function isPublicIpAddress(address: string): boolean {
  try {
    // Mapped IPv4 addresses and transition ranges are intentionally rejected.
    return ipaddr.parse(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function validateWebUrl(
  input: string,
  allowedDomains?: readonly string[],
): URL {
  if (typeof input !== 'string' || input.length > 4096) {
    throw new UnsafeWebUrlError('Invalid web URL');
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new UnsafeWebUrlError('Invalid web URL');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeWebUrlError('Only HTTP and HTTPS URLs are allowed');
  }
  if (url.username || url.password) {
    throw new UnsafeWebUrlError('Credentials in URLs are not allowed');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new UnsafeWebUrlError('Only standard web ports are allowed');
  }

  const host = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!host || host.includes('%')) {
    throw new UnsafeWebUrlError('Invalid web hostname');
  }
  if (ipaddr.isValid(host)) {
    if (!isPublicIpAddress(host)) {
      throw new UnsafeWebUrlError('Local or reserved IP addresses are blocked');
    }
  } else if (
    !host.includes('.') ||
    LOCAL_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    )
  ) {
    throw new UnsafeWebUrlError('Local hostnames are blocked');
  }

  if (allowedDomains?.length) {
    const allowed = allowedDomains.some((domain) => {
      const normalized = domain
        .toLowerCase()
        .replace(/^\./, '')
        .replace(/\.$/, '');
      return host === normalized || host.endsWith(`.${normalized}`);
    });
    if (!allowed) {
      throw new UnsafeWebUrlError('Domain is outside the allowed list');
    }
  }
  url.hash = '';
  return url;
}

export async function resolvePublicAddress(hostname: string): Promise<{
  address: string;
  family: 4 | 6;
}> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) {
    if (!isPublicIpAddress(host)) {
      throw new UnsafeWebUrlError('Local or reserved IP addresses are blocked');
    }
    return {
      address: host,
      family: ipaddr.parse(host).kind() === 'ipv4' ? 4 : 6,
    };
  }

  const addresses = await lookup(host, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some((entry) => !isPublicIpAddress(entry.address))
  ) {
    throw new UnsafeWebUrlError(
      'Hostname resolves to a local or reserved address',
    );
  }
  return (addresses.find((entry) => entry.family === 4) ?? addresses[0]) as {
    address: string;
    family: 4 | 6;
  };
}
