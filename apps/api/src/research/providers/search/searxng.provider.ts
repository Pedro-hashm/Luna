import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ResearchRecency } from '../../dto/research-task.dto';
import type { WebSearchResult } from '../../dto/search-result.dto';
import { normalizeResearchUrl } from '../../sources/source.service';
import type { SearchProvider } from './search-provider';

type SearxngResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  publishedDate?: unknown;
  published_date?: unknown;
  engine?: unknown;
  engines?: unknown;
};

function dateOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function recencyParameter(recency: ResearchRecency): string | undefined {
  if (recency === 'day') return 'day';
  if (recency === 'week') return 'week';
  if (recency === 'month') return 'month';
  if (recency === 'year') return 'year';
  return undefined;
}

@Injectable()
export class SearxngProvider implements SearchProvider {
  readonly name = 'searxng';
  private readonly baseUrl = (
    process.env.SEARXNG_BASE_URL ?? 'http://localhost:8080'
  ).replace(/\/+$/u, '');

  async search(
    query: string,
    options: {
      recency: ResearchRecency;
      maxResults: number;
      timeoutMs: number;
      signal?: AbortSignal;
    },
  ): Promise<WebSearchResult[]> {
    const endpoint = new URL(`${this.baseUrl}/search`);
    endpoint.searchParams.set('q', query);
    endpoint.searchParams.set('format', 'json');
    const recency = recencyParameter(options.recency);
    if (recency) endpoint.searchParams.set('time_range', recency);
    const signal = AbortSignal.any([
      AbortSignal.timeout(options.timeoutMs),
      ...(options.signal ? [options.signal] : []),
    ]);
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok)
      throw new Error(`SearXNG search failed: HTTP ${response.status}`);
    const payload: unknown = await response.json();
    if (
      !payload ||
      typeof payload !== 'object' ||
      !('results' in payload) ||
      !Array.isArray(payload.results)
    ) {
      throw new Error('SearXNG returned an invalid result payload');
    }
    const retrievedAt = new Date().toISOString();
    const normalized: WebSearchResult[] = [];
    const seen = new Set<string>();
    for (const raw of payload.results as SearxngResult[]) {
      if (typeof raw.url !== 'string') continue;
      let normalizedUrl: string;
      try {
        normalizedUrl = normalizeResearchUrl(raw.url);
      } catch {
        continue;
      }
      if (seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);
      const engine =
        typeof raw.engine === 'string'
          ? raw.engine
          : Array.isArray(raw.engines) && typeof raw.engines[0] === 'string'
            ? raw.engines[0]
            : 'searxng';
      normalized.push({
        id: `sr_${createHash('sha256').update(normalizedUrl).digest('hex').slice(0, 20)}`,
        title:
          typeof raw.title === 'string' ? raw.title.trim().slice(0, 500) : '',
        url: raw.url,
        domain: new URL(normalizedUrl).hostname,
        snippet:
          typeof raw.content === 'string'
            ? raw.content.trim().slice(0, 2_000)
            : '',
        rank: normalized.length + 1,
        publishedAt: dateOrUndefined(raw.publishedDate ?? raw.published_date),
        retrievedAt,
        searchEngine: engine,
        query,
      });
      if (normalized.length >= options.maxResults) break;
    }
    return normalized;
  }
}
