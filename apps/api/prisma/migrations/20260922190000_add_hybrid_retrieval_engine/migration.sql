ALTER TABLE "application_settings"
    ADD COLUMN "retrieval_strategy" TEXT NOT NULL DEFAULT 'hybrid',
    ADD COLUMN "retrieval_vector_top_k" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "retrieval_lexical_top_k" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "retrieval_rrf_k" INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN "retrieval_candidate_pool_top_k" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "retrieval_reranker_enabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "retrieval_reranker_model" TEXT NOT NULL DEFAULT 'cross-encoder/ettin-reranker-17m-v1',
    ADD COLUMN "retrieval_reranker_top_k" INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN "retrieval_reranker_threshold" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    ADD COLUMN "retrieval_deduplication_enabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "retrieval_deduplication_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.85;

CREATE INDEX "conversation_chunks_content_fts_idx"
    ON "conversation_chunks"
    USING GIN (to_tsvector('simple'::regconfig, "content"));
