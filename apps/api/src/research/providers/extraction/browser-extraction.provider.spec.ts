import { chromium } from 'playwright';
import { BrowserExtractionProvider } from './browser-extraction.provider';

jest.mock('playwright', () => ({ chromium: { launch: jest.fn() } }));

describe('BrowserExtractionProvider', () => {
  it('rejects an HTTP block page instead of treating its text as evidence', async () => {
    const page = {
      setDefaultTimeout: jest.fn(),
      goto: jest.fn().mockResolvedValue({ status: () => 403 }),
    };
    const context = {
      setOffline: jest.fn().mockResolvedValue(undefined),
      route: jest.fn().mockResolvedValue(undefined),
      routeWebSocket: jest.fn().mockResolvedValue(undefined),
      addInitScript: jest.fn().mockResolvedValue(undefined),
      newPage: jest.fn().mockResolvedValue(page),
      close: jest.fn().mockResolvedValue(undefined),
    };
    (chromium.launch as jest.Mock).mockResolvedValue({
      newContext: jest.fn().mockResolvedValue(context),
    });
    const provider = new BrowserExtractionProvider({} as never);

    await expect(
      provider.extract('https://example.com/blocked'),
    ).rejects.toThrow('Rendered page returned HTTP 403');
    expect(context.close).toHaveBeenCalled();
  });
});
