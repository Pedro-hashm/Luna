-- Enable pgvector for semantic embeddings.
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "summary" TEXT,
ADD COLUMN     "summaryEmbedding" vector;

-- CreateTable
CREATE TABLE "conversation_chunks" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector,
    "start_message_id" UUID NOT NULL,
    "end_message_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_chunks_conversation_id_created_at_idx" ON "conversation_chunks"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "conversation_chunks_start_message_id_idx" ON "conversation_chunks"("start_message_id");

-- CreateIndex
CREATE INDEX "conversation_chunks_end_message_id_idx" ON "conversation_chunks"("end_message_id");

-- AddForeignKey
ALTER TABLE "conversation_chunks" ADD CONSTRAINT "conversation_chunks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_chunks" ADD CONSTRAINT "conversation_chunks_start_message_id_fkey" FOREIGN KEY ("start_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_chunks" ADD CONSTRAINT "conversation_chunks_end_message_id_fkey" FOREIGN KEY ("end_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
