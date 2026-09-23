import { Module } from '@nestjs/common';
import { WebExtractTool } from '../../tools/web-extract.tool';
import { BrowserExtractionProvider } from './browser-extraction.provider';
import { GuardedHttpClient } from './guarded-http.client';
import { StaticExtractionProvider } from './static-extraction.provider';

@Module({
  providers: [
    GuardedHttpClient,
    StaticExtractionProvider,
    BrowserExtractionProvider,
    WebExtractTool,
  ],
  exports: [WebExtractTool],
})
export class ExtractionModule {}
