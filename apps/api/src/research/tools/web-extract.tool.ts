import { Injectable } from '@nestjs/common';
import { BrowserExtractionProvider } from '../providers/extraction/browser-extraction.provider';
import { ExtractedPage } from '../providers/extraction/extraction.types';
import { WebFetchError } from '../providers/extraction/guarded-http.client';
import { StaticExtractionProvider } from '../providers/extraction/static-extraction.provider';
import {
  UnsafeWebUrlError,
  validateWebUrl,
} from '../providers/extraction/web-url-safety';
import { normalizeResearchUrl } from '../sources/source.service';

export interface ExtractedDocument extends ExtractedPage {
  url: string;
  normalizedUrl: string;
  retrievedAt: string;
  wordCount: number;
}

export interface WebExtractOptions {
  timeoutMs?: number;
  maxBytes?: number;
  browserFallbackEnabled?: boolean;
  cacheEnabled?: boolean;
  allowedDomains?: readonly string[];
}

const MIN_STATIC_TEXT_LENGTH = 220;
const MAX_CACHE_ENTRIES = 128;
const CACHE_TTL_MS = 10 * 60_000;

@Injectable()
export class WebExtractTool {
  private readonly cache = new Map<
    string,
    { expiresAt: number; document: ExtractedDocument }
  >();

  constructor(
    private readonly staticProvider: StaticExtractionProvider,
    private readonly browserProvider: BrowserExtractionProvider,
  ) {}

  async extract(
    url: string,
    options: WebExtractOptions = {},
  ): Promise<ExtractedDocument> {
    validateWebUrl(url, options.allowedDomains);
    const normalizedUrl = normalizeResearchUrl(url);
    const cached =
      options.cacheEnabled === false
        ? undefined
        : this.cache.get(normalizedUrl);
    if (cached && cached.expiresAt > Date.now()) return cached.document;

    const extractionOptions = {
      timeoutMs:
        options.timeoutMs ??
        (Number(process.env.WEB_EXTRACT_TIMEOUT_MS) || undefined),
      maxBytes:
        options.maxBytes ??
        (Number(process.env.WEB_EXTRACT_MAX_BYTES) || undefined),
      allowedDomains: options.allowedDomains,
    };
    const deadline = Date.now() + (extractionOptions.timeoutMs ?? 12_000);
    let staticPage: ExtractedPage | undefined;
    let staticError: unknown;
    try {
      staticPage = await this.staticProvider.extract(
        normalizedUrl,
        extractionOptions,
      );
    } catch (error) {
      if (error instanceof UnsafeWebUrlError) throw error;
      staticError = error;
    }

    let page = staticPage;
    const httpFailure =
      staticError instanceof WebFetchError &&
      /HTTP [45]\d\d/u.test(staticError.message);
    if (
      (!page || page.text.length < MIN_STATIC_TEXT_LENGTH) &&
      options.browserFallbackEnabled !== false &&
      !httpFailure &&
      deadline - Date.now() >= 1_000
    ) {
      try {
        const rendered = await this.browserProvider.extract(
          staticPage?.finalUrl ?? normalizedUrl,
          {
            ...extractionOptions,
            timeoutMs: Math.max(1, deadline - Date.now()),
          },
        );
        if (rendered.text.length > (staticPage?.text.length ?? 0))
          page = rendered;
      } catch (error) {
        if (error instanceof UnsafeWebUrlError) throw error;
        if (!page) throw error;
      }
    }
    if (!page) {
      throw staticError instanceof Error
        ? staticError
        : new Error('Web extraction failed');
    }
    if (!page.text.trim())
      throw new Error('Web page contained no extractable text');

    const document: ExtractedDocument = {
      ...page,
      url,
      normalizedUrl,
      retrievedAt: new Date().toISOString(),
      wordCount: page.text.trim().split(/\s+/).length,
    };
    if (
      options.cacheEnabled !== false &&
      document.text.length >= MIN_STATIC_TEXT_LENGTH
    ) {
      if (this.cache.size >= MAX_CACHE_ENTRIES) {
        for (const key of this.cache.keys()) {
          this.cache.delete(key);
          break;
        }
      }
      this.cache.set(normalizedUrl, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        document,
      });
    }
    return document;
  }
}
