import { IncomingHttpHeaders } from 'node:http';
import { gzipSync } from 'node:zlib';
import { GuardedHttpClient, WebFetchError } from './guarded-http.client';
import { UnsafeWebUrlError } from './web-url-safety';

class StubClient extends GuardedHttpClient {
  readonly requests: string[] = [];
  responses: Array<{
    status: number;
    headers: IncomingHttpHeaders;
    body: Buffer;
  }> = [];

  protected override resolveAddress(): Promise<{
    address: string;
    family: 4;
  }> {
    return Promise.resolve({ address: '1.1.1.1', family: 4 });
  }

  protected override fetchOnce(url: URL) {
    this.requests.push(url.toString());
    const response = this.responses.shift();
    if (!response) return Promise.reject(new Error('Unexpected request'));
    return Promise.resolve(response);
  }
}

describe('GuardedHttpClient', () => {
  it('validates each redirect before requesting it', async () => {
    const client = new StubClient();
    client.responses = [
      {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
        body: Buffer.alloc(0),
      },
    ];
    await expect(client.get('https://example.com/start')).rejects.toThrow(
      UnsafeWebUrlError,
    );
    expect(client.requests).toEqual(['https://example.com/start']);
  });

  it('follows a safe relative redirect and reports final URL', async () => {
    const client = new StubClient();
    client.responses = [
      { status: 301, headers: { location: '/article' }, body: Buffer.alloc(0) },
      {
        status: 200,
        headers: { 'content-type': 'text/html' },
        body: Buffer.from('article'),
      },
    ];
    const result = await client.get('https://example.com/start');
    expect(result.finalUrl).toBe('https://example.com/article');
    expect(result.body.toString()).toBe('article');
  });

  it('rejects a compressed response that expands beyond the byte limit', async () => {
    const client = new StubClient();
    client.responses = [
      {
        status: 200,
        headers: { 'content-encoding': 'gzip' },
        body: gzipSync('x'.repeat(2_000)),
      },
    ];
    await expect(
      client.get('https://example.com/', { maxBytes: 1_000 }),
    ).rejects.toThrow(WebFetchError);
  });
});
