import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import type { WebSearchResult } from '../dto/search-result.dto';
import type {
  ResearchSource,
  ResearchSourceType,
} from '../dto/research-result.dto';

const TRACKING_PARAMETERS =
  /^(?:utm_[^=]+|fbclid|gclid|dclid|mc_cid|mc_eid|igshid|ref_src|ref_url)$/iu;

export function normalizeResearchUrl(rawUrl: string): string {
  if (typeof rawUrl !== 'string' || rawUrl.length > 4096) {
    throw new Error('Invalid research URL');
  }
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error('Invalid research URL');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error('Research URL must use public HTTP(S) without credentials');
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMETERS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/u, '');
  return url.toString();
}

export function isPublicResearchUrl(rawUrl: string): boolean {
  try {
    const url = new URL(normalizeResearchUrl(rawUrl));
    const host = url.hostname.replace(/^\[|\]$/gu, '').toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    )
      return false;
    if (isIP(host) === 4) {
      const octets = host.split('.').map(Number);
      if (
        octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        octets[0] >= 224 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
        (octets[0] === 192 && octets[1] === 0) ||
        (octets[0] === 198 && [18, 19].includes(octets[1]))
      )
        return false;
    }
    if (
      isIP(host) === 6 &&
      (/^(?:::|fc|fd|fe[89ab])/iu.test(host) || host.startsWith('::ffff:'))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

export interface SourceSelection {
  selected: Array<{ result: WebSearchResult; reason: string; score: number }>;
  rejected: Array<{ result: WebSearchResult; reason: string }>;
}

export class SourceRegistry {
  private readonly sources = new Map<string, ResearchSource>();

  constructor(private readonly runId: string) {}

  register(result: WebSearchResult): ResearchSource {
    const normalizedUrl = normalizeResearchUrl(result.url);
    const existing = this.sources.get(normalizedUrl);
    if (existing) return existing;
    const source: ResearchSource = {
      id: `src_${createHash('sha256').update(`${this.runId}\n${normalizedUrl}`).digest('hex').slice(0, 20)}`,
      url: result.url,
      normalizedUrl,
      domain: new URL(normalizedUrl).hostname,
      title: result.title || new URL(normalizedUrl).hostname,
      sourceType: classifySource(normalizedUrl),
      rank: result.rank,
      publishedAt: result.publishedAt,
      retrievedAt: result.retrievedAt,
      metadata: {
        snippet: result.snippet,
        searchEngine: result.searchEngine,
        query: result.query,
      },
    };
    this.sources.set(normalizedUrl, source);
    return source;
  }

  list(): ResearchSource[] {
    return [...this.sources.values()];
  }
  size(): number {
    return this.sources.size;
  }
}

export function classifySource(rawUrl: string): ResearchSourceType {
  const host = new URL(rawUrl).hostname.toLowerCase();
  const primaryVendorDomains = [
    'nvidia.com',
    'amd.com',
    'intel.com',
    'apple.com',
    'microsoft.com',
  ];
  if (
    /\.(?:gov|mil)(?:\.[a-z]{2})?$/u.test(host) ||
    /^(?:docs|developer|support)\./u.test(host) ||
    primaryVendorDomains.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    )
  )
    return 'primary';
  if (
    /\.(?:edu|ac)(?:\.[a-z]{2})?$/u.test(host) ||
    host === 'arxiv.org' ||
    host === 'pubmed.ncbi.nlm.nih.gov'
  )
    return 'academic';
  if (
    host === 'github.com' ||
    host === 'stackoverflow.com' ||
    host === 'reddit.com'
  )
    return 'community';
  if (/(?:reuters|apnews|bbc|bloomberg|theguardian|nytimes|cnn)\./u.test(host))
    return 'news';
  if (/(?:trendforce|anandtech|tomshardware|techpowerup)\./u.test(host))
    return 'industry';
  return 'other';
}

function words(value: string): Set<string> {
  const stopWords = new Set([
    'what',
    'which',
    'where',
    'when',
    'why',
    'how',
    'the',
    'and',
    'for',
    'with',
    'from',
    'about',
    'qual',
    'quais',
    'quando',
    'porque',
    'como',
    'para',
    'com',
    'sobre',
    'que',
    'uma',
    'das',
    'dos',
  ]);
  return new Set(
    (
      value
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/gu, '')
        .match(/[a-z0-9]{3,}/gu) ?? []
    )
      .map((word) =>
        word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word,
      )
      .filter((word) => !stopWords.has(word)),
  );
}

function jaccard(first: Set<string>, second: Set<string>): number {
  if (!first.size || !second.size) return 0;
  const overlap = [...first].filter((word) => second.has(word)).length;
  return overlap / (first.size + second.size - overlap);
}

@Injectable()
export class SourceService {
  createRegistry(runId: string): SourceRegistry {
    return new SourceRegistry(runId);
  }

  select(
    results: WebSearchResult[],
    question: string,
    maxSources: number,
    existing: ResearchSource[] = [],
    queryContext = '',
  ): SourceSelection {
    const queryWords = words(`${question} ${queryContext}`);
    const existingUrls = new Set(
      existing.map((source) => source.normalizedUrl),
    );
    const selected: SourceSelection['selected'] = [];
    const rejected: SourceSelection['rejected'] = [];
    const domainCounts = new Map<string, number>();
    const titleSets = existing.map((source) => words(source.title));
    for (const source of existing)
      domainCounts.set(
        source.domain,
        (domainCounts.get(source.domain) ?? 0) + 1,
      );

    const ranked = results
      .map((result) => {
        const titleWords = words(`${result.title} ${result.snippet}`);
        const relevance =
          [...queryWords].filter((word) => titleWords.has(word)).length /
          Math.max(queryWords.size, 1);
        const type = isPublicResearchUrl(result.url)
          ? classifySource(result.url)
          : 'other';
        const sourceWeight = {
          primary: 0.25,
          academic: 0.18,
          industry: 0.15,
          news: 0.12,
          community: 0.04,
          other: 0,
        }[type];
        const publishedTime = result.publishedAt
          ? Date.parse(result.publishedAt)
          : NaN;
        const ageDays = Number.isFinite(publishedTime)
          ? Math.max(0, (Date.now() - publishedTime) / 86_400_000)
          : undefined;
        const freshness = ageDays === undefined ? 0 : 0.15 / (1 + ageDays / 30);
        return {
          result,
          score:
            relevance * 0.55 +
            sourceWeight +
            freshness +
            0.1 / Math.max(result.rank, 1),
        };
      })
      .sort((a, b) => b.score - a.score);

    for (const item of ranked) {
      const { result } = item;
      if (!isPublicResearchUrl(result.url)) {
        rejected.push({ result, reason: 'unsafe_url' });
        continue;
      }
      if (
        queryWords.size &&
        ![...queryWords].some((word) =>
          words(`${result.title} ${result.snippet}`).has(word),
        )
      ) {
        rejected.push({ result, reason: 'irrelevant_result' });
        continue;
      }
      const normalized = normalizeResearchUrl(result.url);
      const domain = new URL(normalized).hostname;
      const titleWords = words(result.title);
      if (existingUrls.has(normalized)) {
        rejected.push({ result, reason: 'duplicate_url' });
        continue;
      }
      if (titleSets.some((other) => jaccard(titleWords, other) >= 0.82)) {
        rejected.push({ result, reason: 'near_duplicate_title' });
        continue;
      }
      if ((domainCounts.get(domain) ?? 0) >= 2) {
        rejected.push({ result, reason: 'domain_limit' });
        continue;
      }
      if (selected.length >= maxSources) {
        rejected.push({ result, reason: 'source_limit' });
        continue;
      }
      selected.push({
        ...item,
        reason: 'relevance_authority_freshness_diversity',
      });
      existingUrls.add(normalized);
      titleSets.push(titleWords);
      domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    }
    return { selected, rejected };
  }
}
