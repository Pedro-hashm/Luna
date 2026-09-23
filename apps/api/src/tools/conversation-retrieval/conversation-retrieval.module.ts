import { Module } from '@nestjs/common';
import { ConversationEmbeddingModule } from '../../conversation/conversation-embedding.module';
import { FILTER_RETRIEVER, LEXICAL_RETRIEVER, RERANKER, VECTOR_RETRIEVER } from '../../retrieval/retrieval.types';
import type { Retriever } from '../../retrieval/retrieval.types';
import { LocalCrossEncoderRanker } from '../../retrieval/local-cross-encoder-ranker.service';
import { LocalRerankerClient } from '../../retrieval/local-reranker.client';
import { RetrievalController } from '../../retrieval/retrieval.controller';
import { RetrievalEngine } from '../../retrieval/retrieval-engine.service';
import { ReciprocalRankFusion } from '../../retrieval/rrf-fusion.service';
import { ResultDeduplicator } from '../../retrieval/result-deduplicator.service';
import { RetrievalResultCompiler } from '../../retrieval/result-compiler.service';
import { ConversationChunkRetrievalProvider } from './conversation-chunk-retrieval.provider';
import { ConversationRetrievalService } from './conversation-retrieval.service';

@Module({
  imports: [ConversationEmbeddingModule],
  controllers: [RetrievalController],
  providers: [
    ConversationChunkRetrievalProvider,
    {
      provide: VECTOR_RETRIEVER,
      useFactory: (provider: ConversationChunkRetrievalProvider): Retriever => ({
        retrieve: (query, config) => provider.retrieveVector(query, config.topK),
      }),
      inject: [ConversationChunkRetrievalProvider],
    },
    {
      provide: LEXICAL_RETRIEVER,
      useFactory: (provider: ConversationChunkRetrievalProvider): Retriever => ({
        retrieve: (query, config) => provider.retrieveLexical(query, config.topK),
      }),
      inject: [ConversationChunkRetrievalProvider],
    },
    {
      provide: FILTER_RETRIEVER,
      useFactory: (provider: ConversationChunkRetrievalProvider): Retriever => ({
        retrieve: (query, config) => provider.retrieveFiltered(query, config.topK),
      }),
      inject: [ConversationChunkRetrievalProvider],
    },
    LocalRerankerClient,
    LocalCrossEncoderRanker,
    { provide: RERANKER, useExisting: LocalCrossEncoderRanker },
    ReciprocalRankFusion,
    ResultDeduplicator,
    RetrievalResultCompiler,
    RetrievalEngine,
    ConversationRetrievalService,
  ],
  exports: [ConversationRetrievalService, ConversationChunkRetrievalProvider, RetrievalEngine],
})
export class ConversationRetrievalModule {}
