import type { ResearchRecency } from '../../dto/research-task.dto';
import type { WebSearchResult } from '../../dto/search-result.dto';

export const SEARCH_PROVIDER = Symbol('SEARCH_PROVIDER');

export interface SearchProvider {
  readonly name: string;
  search(
    query: string,
    options: {
      recency: ResearchRecency;
      maxResults: number;
      timeoutMs: number;
      signal?: AbortSignal;
    },
  ): Promise<WebSearchResult[]>;
}
