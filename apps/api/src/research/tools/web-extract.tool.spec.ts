import { BrowserExtractionProvider } from '../providers/extraction/browser-extraction.provider';
import { WebFetchError } from '../providers/extraction/guarded-http.client';
import { StaticExtractionProvider } from '../providers/extraction/static-extraction.provider';
import { WebExtractTool } from './web-extract.tool';

describe('WebExtractTool', () => {
  const shortPage = {
    finalUrl: 'https://example.com/',
    title: 'Loading',
    text: 'Loading...',
    contentType: 'text/html',
    extractionMethod: 'static' as const,
  };
  const renderedPage = {
    ...shortPage,
    title: 'Article',
    text: 'Useful evidence '.repeat(30),
    extractionMethod: 'browser' as const,
  };

  it('uses browser fallback for a thin page and caches normalized URLs', async () => {
    const staticProvider = { extract: jest.fn().mockResolvedValue(shortPage) };
    const browserProvider = {
      extract: jest.fn().mockResolvedValue(renderedPage),
    };
    const tool = new WebExtractTool(
      staticProvider as unknown as StaticExtractionProvider,
      browserProvider as unknown as BrowserExtractionProvider,
    );
    const first = await tool.extract('https://example.com/?utm_source=test');
    const second = await tool.extract('https://example.com/');
    expect(first.extractionMethod).toBe('browser');
    expect(first.normalizedUrl).toBe('https://example.com/');
    expect(first.wordCount).toBe(60);
    expect(second).toBe(first);
    expect(staticProvider.extract).toHaveBeenCalledTimes(1);
    expect(browserProvider.extract).toHaveBeenCalledTimes(1);
  });

  it('honors the browser toggle and cache bypass', async () => {
    const staticProvider = { extract: jest.fn().mockResolvedValue(shortPage) };
    const browserProvider = {
      extract: jest.fn().mockResolvedValue(renderedPage),
    };
    const tool = new WebExtractTool(
      staticProvider as unknown as StaticExtractionProvider,
      browserProvider as unknown as BrowserExtractionProvider,
    );
    const result = await tool.extract('https://example.com/', {
      browserFallbackEnabled: false,
      cacheEnabled: false,
    });
    expect(result.extractionMethod).toBe('static');
    expect(browserProvider.extract).not.toHaveBeenCalled();
    await tool.extract('https://example.com/', {
      browserFallbackEnabled: false,
      cacheEnabled: false,
    });
    expect(staticProvider.extract).toHaveBeenCalledTimes(2);
  });

  it('does not retry blocked HTTP responses with a browser', async () => {
    const staticProvider = {
      extract: jest
        .fn()
        .mockRejectedValue(new WebFetchError('Web page returned HTTP 403')),
    };
    const browserProvider = { extract: jest.fn() };
    const tool = new WebExtractTool(
      staticProvider as unknown as StaticExtractionProvider,
      browserProvider as unknown as BrowserExtractionProvider,
    );
    await expect(tool.extract('https://example.com/')).rejects.toThrow(
      'HTTP 403',
    );
    expect(browserProvider.extract).not.toHaveBeenCalled();
  });

  it('shares one timeout between static and browser extraction', async () => {
    const staticProvider = {
      extract: jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return shortPage;
      }),
    };
    let remainingTimeout: number | undefined;
    const browserProvider = {
      extract: jest
        .fn()
        .mockImplementation((_url: string, options: { timeoutMs?: number }) => {
          remainingTimeout = options.timeoutMs;
          return Promise.resolve(renderedPage);
        }),
    };
    const tool = new WebExtractTool(
      staticProvider as unknown as StaticExtractionProvider,
      browserProvider as unknown as BrowserExtractionProvider,
    );
    await tool.extract('https://example.com/', { timeoutMs: 2_000 });
    expect(browserProvider.extract).toHaveBeenCalledTimes(1);
    expect(remainingTimeout).toBeLessThan(2_000);
    expect(remainingTimeout).toBeGreaterThanOrEqual(1_000);
  });
});
