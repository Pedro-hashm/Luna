import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Browser, chromium } from 'playwright';
import { GuardedHttpClient, WebFetchError } from './guarded-http.client';
import { extractHtmlContent } from './html-content';
import {
  ExtractedPage,
  ExtractionOptions,
  ExtractionProvider,
} from './extraction.types';
import { validateWebUrl } from './web-url-safety';

const MAX_BROWSER_REQUESTS = 50;
const MAX_BROWSER_BYTES = 8_000_000;

@Injectable()
export class BrowserExtractionProvider
  implements ExtractionProvider, OnModuleDestroy
{
  private browserPromise?: Promise<Browser>;

  constructor(private readonly http: GuardedHttpClient) {}

  async extract(
    url: string,
    options: ExtractionOptions = {},
  ): Promise<ExtractedPage> {
    const target = validateWebUrl(url, options.allowedDomains);
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      serviceWorkers: 'block',
      acceptDownloads: false,
      javaScriptEnabled: true,
    });
    // Intercepted requests still work while Chromium itself has no network access.
    await context.setOffline(true);
    const timeoutMs = Math.min(
      Math.max(options.timeoutMs ?? 12_000, 1_000),
      30_000,
    );
    const deadline = Date.now() + timeoutMs;
    let totalBytes = 0;
    let requestCount = 0;
    let finalUrl = target.toString();

    try {
      // Every browser HTTP request is fulfilled from our DNS-pinned transport.
      // Chromium never receives permission to perform a direct network fetch.
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (
          request.method() !== 'GET' ||
          ['image', 'media', 'font', 'stylesheet'].includes(
            request.resourceType(),
          )
        ) {
          await route.abort();
          return;
        }
        if (++requestCount > MAX_BROWSER_REQUESTS || Date.now() >= deadline) {
          await route.abort();
          return;
        }
        try {
          const requestedUrl = validateWebUrl(
            request.url(),
            options.allowedDomains,
          );
          const remainingBytes = MAX_BROWSER_BYTES - totalBytes;
          if (remainingBytes <= 0)
            throw new WebFetchError('Browser byte limit reached');
          const response = await this.http.get(requestedUrl.toString(), {
            timeoutMs: Math.max(1, deadline - Date.now()),
            maxBytes: Math.min(options.maxBytes ?? 2_000_000, remainingBytes),
            allowedDomains: options.allowedDomains,
          });
          totalBytes += response.body.length;
          if (
            request.isNavigationRequest() &&
            request.frame() === context.pages()[0]?.mainFrame()
          ) {
            finalUrl = response.finalUrl;
          }
          await route.fulfill({
            status: response.status,
            contentType: String(
              response.headers['content-type'] ?? 'text/html',
            ),
            body: response.body,
          });
        } catch {
          await route.abort();
        }
      });
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.addInitScript(() => {
        // Routes block ordinary requests; these APIs could open other channels.
        Object.defineProperty(window, 'EventSource', { value: undefined });
        Object.defineProperty(window, 'Worker', { value: undefined });
        Object.defineProperty(window, 'SharedWorker', { value: undefined });
        Object.defineProperty(window, 'RTCPeerConnection', {
          value: undefined,
        });
        Object.defineProperty(window, 'webkitRTCPeerConnection', {
          value: undefined,
        });
        Object.defineProperty(window, 'open', { value: () => null });
        Object.defineProperty(navigator, 'sendBeacon', { value: () => false });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      const navigation = await page.goto(target.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: Math.max(1, deadline - Date.now()),
      });
      if (
        !navigation ||
        navigation.status() < 200 ||
        navigation.status() >= 300
      ) {
        throw new WebFetchError(
          `Rendered page returned HTTP ${navigation?.status() ?? 'unknown'}`,
        );
      }
      await page.waitForTimeout(
        Math.min(850, Math.max(0, deadline - Date.now())),
      );
      const html = await page.content();
      if (Buffer.byteLength(html, 'utf8') > (options.maxBytes ?? 2_000_000)) {
        throw new WebFetchError('Rendered page exceeded size limit');
      }
      const content = extractHtmlContent(html);
      return {
        ...content,
        finalUrl,
        contentType: 'text/html',
        extractionMethod: 'browser',
      };
    } finally {
      await context.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise) await (await this.browserPromise).close();
  }

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.browserPromise = chromium
        .launch({ headless: true })
        .catch((error: unknown) => {
          this.browserPromise = undefined;
          throw error;
        });
    }
    return this.browserPromise;
  }
}
