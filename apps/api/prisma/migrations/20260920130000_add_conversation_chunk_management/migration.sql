-- Conversation chunks can remain open while new messages are appended.
CREATE TYPE "ConversationChunkStatus" AS ENUM ('open', 'closed');

ALTER TABLE "conversation_chunks"
ADD COLUMN "status" "ConversationChunkStatus" NOT NULL DEFAULT 'open',
ADD COLUMN "token_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "embedding_token_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "conversation_chunk_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "max_tokens" INTEGER NOT NULL DEFAULT 4000,
    "overlap_tokens" INTEGER NOT NULL DEFAULT 800,
    "embedding_refresh_tokens" INTEGER NOT NULL DEFAULT 1000,
    "embedding_model" TEXT NOT NULL DEFAULT 'qwen3-embedding:0.6b',
    "embedding_dimensions" INTEGER NOT NULL DEFAULT 1024,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_chunk_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "conversation_chunk_settings_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "conversation_chunk_settings_limits_check" CHECK (
        "max_tokens" > 0
        AND "overlap_tokens" >= 0
        AND "overlap_tokens" < "max_tokens"
        AND "embedding_refresh_tokens" > 0
        AND "embedding_dimensions" = 1024
    )
);

INSERT INTO "conversation_chunk_settings" (
    "id",
    "max_tokens",
    "overlap_tokens",
    "embedding_refresh_tokens",
    "embedding_model",
    "embedding_dimensions"
)
VALUES (1, 4000, 800, 1000, 'qwen3-embedding:0.6b', 1024)
ON CONFLICT ("id") DO NOTHING;

CREATE INDEX "conversation_chunks_conversation_id_status_created_at_idx"
ON "conversation_chunks"("conversation_id", "status", "created_at");

CREATE INDEX "conversation_chunks_embedding_hnsw_idx"
ON "conversation_chunks" USING hnsw ("embedding" vector_cosine_ops)
WHERE "embedding" IS NOT NULL;
