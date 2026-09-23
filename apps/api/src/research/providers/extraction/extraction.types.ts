export interface ExtractedPage {
  finalUrl: string;
  title: string;
  text: string;
  description?: string;
  publishedAt?: string;
  contentType: string;
  extractionMethod: 'static' | 'browser';
}

export interface ExtractionOptions {
  timeoutMs?: number;
  maxBytes?: number;
  allowedDomains?: readonly string[];
}

export interface ExtractionProvider {
  extract(url: string, options?: ExtractionOptions): Promise<ExtractedPage>;
}
