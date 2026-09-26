import { Injectable } from '@nestjs/common';
import { request as httpRequest, IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { resolvePublicAddress, validateWebUrl } from './web-url-safety';

export interface GuardedFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  allowedDomains?: readonly string[];
  httpsOnly?: boolean;
}

export interface GuardedHttpResponse {
  finalUrl: string;
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebFetchError';
  }
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  return Number.isFinite(value) && value! > 0
    ? Math.min(Math.floor(value!), max)
    : fallback;
}

function decodeBody(
  body: Buffer,
  headers: IncomingHttpHeaders,
  maxBytes: number,
): Buffer {
  const encoding = String(
    headers['content-encoding'] ?? 'identity',
  ).toLowerCase();
  let decoded: Buffer;
  try {
    switch (encoding) {
      case 'identity':
        decoded = body;
        break;
      case 'gzip':
        decoded = gunzipSync(body, { maxOutputLength: maxBytes });
        break;
      case 'deflate':
        decoded = inflateSync(body, { maxOutputLength: maxBytes });
        break;
      case 'br':
        decoded = brotliDecompressSync(body, { maxOutputLength: maxBytes });
        break;
      default:
        throw new WebFetchError(`Unsupported content encoding: ${encoding}`);
    }
  } catch (error) {
    if (error instanceof WebFetchError) throw error;
    throw new WebFetchError(
      'Response decompression failed or exceeded size limit',
    );
  }
  if (decoded.length > maxBytes) {
    throw new WebFetchError('Response exceeded size limit');
  }
  return decoded;
}

@Injectable()
export class GuardedHttpClient {
  async get(
    input: string,
    options: GuardedFetchOptions = {},
  ): Promise<GuardedHttpResponse> {
    const timeoutMs = boundedInteger(options.timeoutMs, 8_000, 30_000);
    const maxBytes = boundedInteger(options.maxBytes, 2_000_000, 10_000_000);
    const maxRedirects = boundedInteger(options.maxRedirects, 5, 10);
    const deadline = Date.now() + timeoutMs;
    let url = validateWebUrl(input, options.allowedDomains);
    if (options.httpsOnly && url.protocol !== 'https:') throw new WebFetchError('HTTPS is required');

    for (let redirect = 0; redirect <= maxRedirects; redirect++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new WebFetchError('Web request timed out');
      let dnsTimer: ReturnType<typeof setTimeout> | undefined;
      const destination = await Promise.race([
        this.resolveAddress(url.hostname),
        new Promise<never>((_, reject) => {
          dnsTimer = setTimeout(
            () => reject(new WebFetchError('DNS lookup timed out')),
            remaining,
          );
        }),
      ]).finally(() => clearTimeout(dnsTimer));
      const response = await this.fetchOnce(
        url,
        destination,
        deadline - Date.now(),
        maxBytes,
      );

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.location;
        if (!location) throw new WebFetchError('Redirect had no location');
        if (redirect === maxRedirects)
          throw new WebFetchError('Too many redirects');
        let destinationUrl: string;
        try {
          destinationUrl = new URL(location, url).toString();
        } catch {
          throw new WebFetchError('Redirect location is invalid');
        }
        url = validateWebUrl(destinationUrl, options.allowedDomains);
        if (options.httpsOnly && url.protocol !== 'https:') throw new WebFetchError('HTTPS is required for redirects');
        continue;
      }

      return {
        ...response,
        finalUrl: url.toString(),
        body: decodeBody(response.body, response.headers, maxBytes),
      };
    }
    throw new WebFetchError('Too many redirects');
  }

  protected resolveAddress(
    hostname: string,
  ): ReturnType<typeof resolvePublicAddress> {
    return resolvePublicAddress(hostname);
  }

  protected fetchOnce(
    url: URL,
    destination: { address: string; family: 4 | 6 },
    timeoutMs: number,
    maxBytes: number,
  ): Promise<Omit<GuardedHttpResponse, 'finalUrl'>> {
    if (timeoutMs <= 0)
      return Promise.reject(new WebFetchError('Web request timed out'));
    return new Promise((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        {
          hostname: destination.address,
          family: destination.family,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          servername: url.hostname.replace(/^\[|\]$/g, ''),
          headers: {
            Host: url.host,
            Accept:
              'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'Accept-Encoding': 'identity',
            'User-Agent': 'LunaResearchBot/1.0',
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const contentLength = Number(response.headers['content-length']);
          if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            request.destroy(new WebFetchError('Response exceeded size limit'));
            return;
          }
          if ([301, 302, 303, 307, 308].includes(status)) {
            response.destroy();
            resolve({
              status,
              headers: response.headers,
              body: Buffer.alloc(0),
            });
            return;
          }

          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              request.destroy(
                new WebFetchError('Response exceeded size limit'),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () =>
            resolve({
              status,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
          response.on('error', reject);
        },
      );
      const timer = setTimeout(
        () => request.destroy(new WebFetchError('Web request timed out')),
        timeoutMs,
      );
      request.on('error', reject);
      request.on('close', () => clearTimeout(timer));
      request.end();
    });
  }
}
