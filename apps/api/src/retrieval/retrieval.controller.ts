import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { LocalRerankerClient } from './local-reranker.client';
import { RERANKER_MODELS } from './retrieval.types';
import type { RerankerModel } from './retrieval.types';

type RerankerComparisonRequest = {
  query?: unknown;
  documents?: unknown;
  threshold?: unknown;
};

@Controller('retrieval')
export class RetrievalController {
  constructor(private readonly reranker: LocalRerankerClient) {}

  @Get('rerankers')
  getRerankerModels() {
    return this.reranker.getModels();
  }

  @Post('rerankers/:model/download')
  downloadReranker(@Param('model') model: string) {
    if (!RERANKER_MODELS.includes(model as RerankerModel)) {
      throw new BadRequestException('Unsupported reranker model');
    }
    return this.reranker.download(model as RerankerModel);
  }

  @Post('rerankers/compare')
  async compareRerankers(@Body() input: RerankerComparisonRequest) {
    if (typeof input.query !== 'string' || !input.query.trim()) {
      throw new BadRequestException('query must be a non-empty string');
    }
    if (
      !Array.isArray(input.documents) ||
      input.documents.length < 1 ||
      input.documents.length > 100 ||
      input.documents.some((document) => typeof document !== 'string')
    ) {
      throw new BadRequestException('documents must contain 1 to 100 strings');
    }
    const threshold = input.threshold ?? 0.05;
    if (typeof threshold !== 'number' || threshold < -100 || threshold > 100) {
      throw new BadRequestException('threshold must be between -100 and 100');
    }

    const candidates = (input.documents as string[]).map((content, index) => ({
      id: String(index),
      content,
      source: 'benchmark',
      metadata: {},
    }));
    const runs = await Promise.all(
      RERANKER_MODELS.map(async (model) => {
        const startedAt = Date.now();
        const results = await this.reranker.rerank(input.query as string, candidates, model);
        return {
          model,
          latencyMs: Date.now() - startedAt,
          aboveThreshold: results.filter(
            (candidate) => (candidate.rerankerScore ?? 0) >= threshold,
          ).length,
          results: results.map((candidate) => ({
            index: Number(candidate.id),
            score: candidate.rerankerScore,
          })),
        };
      }),
    );
    return { query: input.query, threshold, runs };
  }
}
