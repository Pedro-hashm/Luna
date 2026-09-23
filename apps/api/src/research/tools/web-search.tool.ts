import { Inject, Injectable } from '@nestjs/common';
import type { ResearchRecency } from '../dto/research-task.dto';
import type {
  WebSearchResponse,
  WebSearchResult,
} from '../dto/search-result.dto';
import {
  SEARCH_PROVIDER,
  type SearchProvider,
} from '../providers/search/search-provider';

type CacheEntry = { expiresAt: number; results: WebSearchResult[] };

@Injectable()
export class WebSearchTool {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs = Math.max(
    1_000,
    Number(process.env.WEB_SEARCH_CACHE_TTL_MS) || 120_000,
  );

  constructor(
    @Inject(SEARCH_PROVIDER) private readonly provider: SearchProvider,
  ) {}

  async search(
    query: string,
    options: {
      recency?: ResearchRecency;
      maxResults?: number;
      timeoutMs?: number;
      cacheEnabled?: boolean;
      signal?: AbortSignal;
    } = {},
  ): Promise<WebSearchResponse> {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length > 500)
      throw new Error('Search query must contain 1–500 characters');
    const recency = options.recency ?? 'auto';
    const maxResults = Math.min(20, Math.max(1, options.maxResults ?? 8));
    const key = JSON.stringify([
      this.provider.name,
      trimmed.toLowerCase(),
      recency,
      maxResults,
    ]);
    const started = Date.now();
    const cached = this.cache.get(key);
    if (
      options.cacheEnabled !== false &&
      cached &&
      cached.expiresAt > started
    ) {
      return {
        query: trimmed,
        provider: this.provider.name,
        results: cached.results,
        fromCache: true,
        latencyMs: Date.now() - started,
      };
    }
    if (this.cache.size > 200) {
      for (const [cacheKey, entry] of this.cache) {
        if (entry.expiresAt <= started) this.cache.delete(cacheKey);
      }
      if (this.cache.size > 200) {
        const oldestKey: unknown = this.cache.keys().next().value;
        if (typeof oldestKey === 'string') this.cache.delete(oldestKey);
      }
    }
    const results = await this.provider.search(trimmed, {
      recency,
      maxResults,
      timeoutMs: Math.min(30_000, Math.max(500, options.timeoutMs ?? 8_000)),
      signal: options.signal,
    });
    if (options.cacheEnabled !== false)
      this.cache.set(key, { results, expiresAt: started + this.cacheTtlMs });
    return {
      query: trimmed,
      provider: this.provider.name,
      results,
      fromCache: false,
      latencyMs: Date.now() - started,
    };
  }
}
