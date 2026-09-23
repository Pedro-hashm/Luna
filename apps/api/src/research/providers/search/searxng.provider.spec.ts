import { SearxngProvider } from './searxng.provider';

describe('SearxngProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('normalizes, deduplicates, and bounds result metadata', async () => {
    let requestedUrl: URL | undefined;
    const fetchMock = jest.fn((input: URL) => {
      requestedUrl = input;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              {
                url: 'https://example.com/article?utm_source=search',
                title: 'Example',
                content: 'Summary',
                engine: 'bing',
                publishedDate: '2026-09-20',
              },
              {
                url: 'https://example.com/article',
                title: 'Duplicate',
                content: 'Summary',
              },
              { url: 'javascript:alert(1)', title: 'Unsafe' },
            ],
          }),
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const results = await new SearxngProvider().search('test', {
      recency: 'week',
      maxResults: 8,
      timeoutMs: 1000,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Example',
      rank: 1,
      searchEngine: 'bing',
      domain: 'example.com',
    });
    expect(results[0].publishedAt).toBe('2026-09-20T00:00:00.000Z');
    expect(requestedUrl?.searchParams.get('time_range')).toBe('week');
  });

  it('reports provider HTTP errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(
      new SearxngProvider().search('test', {
        recency: 'auto',
        maxResults: 8,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow('HTTP 503');
  });
});
