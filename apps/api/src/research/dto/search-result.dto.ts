export interface WebSearchResult {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  rank: number;
  publishedAt?: string;
  retrievedAt: string;
  searchEngine: string;
  query: string;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  results: WebSearchResult[];
  fromCache: boolean;
  latencyMs: number;
}
