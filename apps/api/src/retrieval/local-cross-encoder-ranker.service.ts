import { Injectable } from '@nestjs/common';
import type { Ranker, RetrievalCandidate, RerankerModel } from './retrieval.types';
import { LocalRerankerClient } from './local-reranker.client';

@Injectable()
export class LocalCrossEncoderRanker implements Ranker {
  constructor(private readonly reranker: LocalRerankerClient) {}

  rank(
    query: string,
    candidates: RetrievalCandidate[],
    model: RerankerModel,
  ): Promise<RetrievalCandidate[]> {
    return this.reranker.rerank(query, candidates, model);
  }
}
