import { Injectable } from '@nestjs/common';
import { GuardedHttpClient, WebFetchError } from './guarded-http.client';
import { extractHtmlContent } from './html-content';
import {
  ExtractedPage,
  ExtractionOptions,
  ExtractionProvider,
} from './extraction.types';

@Injectable()
export class StaticExtractionProvider implements ExtractionProvider {
  constructor(private readonly http: GuardedHttpClient) {}

  async extract(
    url: string,
    options: ExtractionOptions = {},
  ): Promise<ExtractedPage> {
    const response = await this.http.get(url, options);
    if (response.status < 200 || response.status >= 300) {
      throw new WebFetchError(`Web page returned HTTP ${response.status}`);
    }
    const contentType = String(
      response.headers['content-type'] ?? '',
    ).toLowerCase();
    if (
      contentType &&
      !/(text\/html|application\/xhtml\+xml|text\/plain)/.test(contentType)
    ) {
      throw new WebFetchError(`Unsupported page content type: ${contentType}`);
    }
    const charset =
      contentType.match(/charset\s*=\s*([^;\s]+)/)?.[1] ?? 'utf-8';
    let html: string;
    try {
      html = new TextDecoder(charset).decode(response.body);
    } catch {
      html = new TextDecoder('utf-8').decode(response.body);
    }
    const content = contentType.includes('text/plain')
      ? { title: '', text: html.trim() }
      : extractHtmlContent(html);
    return {
      ...content,
      finalUrl: response.finalUrl,
      contentType: contentType || 'text/html',
      extractionMethod: 'static',
    };
  }
}
