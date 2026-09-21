-- Qwen Embedding 0.6B produces vectors with 1024 dimensions.
ALTER TABLE "conversations"
ALTER COLUMN "summary_embedding" TYPE vector(1024);

ALTER TABLE "conversation_chunks"
ALTER COLUMN "embedding" TYPE vector(1024);
