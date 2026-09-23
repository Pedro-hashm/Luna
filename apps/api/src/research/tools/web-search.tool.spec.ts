import { WebSearchTool } from './web-search.tool';
import type { SearchProvider } from '../providers/search/search-provider';

describe('WebSearchTool', () => {
  it('caches equal queries and allows a cache bypass', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const provider: SearchProvider = {
      name: 'test',
      search,
    };
    const tool = new WebSearchTool(provider);
    expect((await tool.search('query')).fromCache).toBe(false);
    expect((await tool.search('query')).fromCache).toBe(true);
    expect(
      (await tool.search('query', { cacheEnabled: false })).fromCache,
    ).toBe(false);
    expect(search).toHaveBeenCalledTimes(2);
  });
});
