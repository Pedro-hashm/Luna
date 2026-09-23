import {
  SourceService,
  classifySource,
  isPublicResearchUrl,
  normalizeResearchUrl,
} from './source.service';
import type { WebSearchResult } from '../dto/search-result.dto';

function result(url: string, title: string, rank: number): WebSearchResult {
  return {
    id: `sr_${rank}`,
    url,
    title,
    rank,
    domain: new URL(url).hostname,
    snippet: 'Official information about DRAM prices and market trends.',
    publishedAt: '2026-09-20T00:00:00.000Z',
    retrievedAt: '2026-09-23T00:00:00.000Z',
    searchEngine: 'test',
    query: 'DRAM price trends',
  };
}

describe('SourceService', () => {
  it('normalizes tracking parameters and assigns stable per-run IDs', () => {
    expect(
      normalizeResearchUrl(
        'HTTPS://Example.COM/story/?utm_source=x&b=2&a=1#section',
      ),
    ).toBe('https://example.com/story?a=1&b=2');
    const registry = new SourceService().createRegistry(
      '00000000-0000-0000-0000-000000000001',
    );
    const first = registry.register(
      result('https://example.com/story?utm_source=x', 'Story', 1),
    );
    const second = registry.register(
      result('https://example.com/story', 'Story', 2),
    );
    expect(first.id).toMatch(/^src_[a-f0-9]{20}$/u);
    expect(second.id).toBe(first.id);
    expect(registry.size()).toBe(1);
  });

  it('rejects local and private URL candidates', () => {
    for (const url of [
      'http://localhost/',
      'http://127.0.0.1/',
      'http://10.0.0.1/',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/',
      'file:///etc/passwd',
    ]) {
      expect(isPublicResearchUrl(url)).toBe(false);
    }
    expect(isPublicResearchUrl('https://www.example.org/article')).toBe(true);
  });

  it('treats official manufacturer sites as primary sources', () => {
    expect(
      classifySource('https://www.nvidia.com/en-us/geforce/graphics-cards/'),
    ).toBe('primary');
    expect(classifySource('https://nvidia.com.evil.example/specs')).toBe(
      'other',
    );
  });

  it('selects distinct sources with a domain limit and recorded rejection reasons', () => {
    const service = new SourceService();
    const selection = service.select(
      [
        result('https://example.com/a', 'DRAM price report A', 1),
        result('https://example.com/b', 'DRAM supply report B', 2),
        result('https://example.com/c', 'DRAM production report C', 3),
        result('https://other.com/a', 'Memory contract price outlook', 4),
        result('http://127.0.0.1/admin', 'DRAM private', 5),
      ],
      'DRAM price trends',
      4,
    );
    expect(selection.selected.length).toBe(3);
    expect(selection.rejected.map((item) => item.reason)).toEqual(
      expect.arrayContaining(['domain_limit', 'unsafe_url']),
    );
  });

  it('rejects unrelated search hits despite their rank', () => {
    const selection = new SourceService().select(
      [result('https://example.com/garden', 'Beautiful garden flowers', 1)],
      'Capital of Australia',
      5,
    );
    expect(selection.selected).toHaveLength(0);
    expect(selection.rejected[0].reason).toBe('irrelevant_result');
  });
});
