CREATE TYPE "TemporalRelationType" AS ENUM ('SUPERSEDES', 'CORRECTS');

ALTER TABLE "application_settings"
  ADD COLUMN "temporal_consolidation_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporal_consolidation_default_combo" TEXT,
  ADD COLUMN "temporal_consolidation_fallback_combo" TEXT,
  ADD COLUMN "temporal_consolidation_start_time" TEXT NOT NULL DEFAULT '04:30',
  ADD COLUMN "temporal_consolidation_end_time" TEXT NOT NULL DEFAULT '08:30';

CREATE TABLE "temporal_relations" (
  "id" UUID NOT NULL,
  "predecessor_message_id" UUID NOT NULL,
  "successor_message_id" UUID NOT NULL,
  "type" "TemporalRelationType" NOT NULL,
  "subject" TEXT NOT NULL,
  "old_value" TEXT NOT NULL,
  "new_value" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "temporal_relations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "temporal_relations_distinct_messages" CHECK ("predecessor_message_id" <> "successor_message_id"),
  CONSTRAINT "temporal_relations_confidence_range" CHECK ("confidence" >= 0 AND "confidence" <= 1)
);

CREATE UNIQUE INDEX "temporal_relations_predecessor_message_id_key"
  ON "temporal_relations"("predecessor_message_id");
CREATE INDEX "temporal_relations_successor_message_id_idx"
  ON "temporal_relations"("successor_message_id");
CREATE INDEX "temporal_relations_created_at_idx"
  ON "temporal_relations"("created_at");
ALTER TABLE "temporal_relations"
  ADD CONSTRAINT "temporal_relations_predecessor_message_id_fkey"
  FOREIGN KEY ("predecessor_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "temporal_relations"
  ADD CONSTRAINT "temporal_relations_successor_message_id_fkey"
  FOREIGN KEY ("successor_message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "temporal_consolidation_checkpoint" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "last_message_created_at" TIMESTAMP(3),
  "last_message_id" UUID,
  "active_run_id" UUID,
  "lock_expires_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "temporal_consolidation_checkpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "temporal_consolidation_runs" (
  "id" UUID NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "dry_run" BOOLEAN NOT NULL DEFAULT false,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "default_combo" TEXT,
  "fallback_combo" TEXT,
  "actual_combo" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "messages_scanned" INTEGER NOT NULL DEFAULT 0,
  "chunks_scanned" INTEGER NOT NULL DEFAULT 0,
  "candidates_detected" INTEGER NOT NULL DEFAULT 0,
  "llm_calls" INTEGER NOT NULL DEFAULT 0,
  "historical_retrieval_calls" INTEGER NOT NULL DEFAULT 0,
  "relations_proposed" INTEGER NOT NULL DEFAULT 0,
  "relations_created" INTEGER NOT NULL DEFAULT 0,
  "relations_rejected" INTEGER NOT NULL DEFAULT 0,
  "relations_skipped" INTEGER NOT NULL DEFAULT 0,
  "fallback_used" BOOLEAN NOT NULL DEFAULT false,
  "fallback_reason" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "candidate_detection_latency_ms" INTEGER NOT NULL DEFAULT 0,
  "llm_latency_ms" INTEGER NOT NULL DEFAULT 0,
  "historical_retrieval_latency_ms" INTEGER NOT NULL DEFAULT 0,
  "validation_latency_ms" INTEGER NOT NULL DEFAULT 0,
  "persistence_latency_ms" INTEGER NOT NULL DEFAULT 0,
  "rejection_reasons" JSONB,
  "proposed" JSONB,
  "rejected" JSONB,
  "has_more" BOOLEAN NOT NULL DEFAULT false,
  "error_message" TEXT,
  CONSTRAINT "temporal_consolidation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "temporal_consolidation_runs_started_at_idx"
  ON "temporal_consolidation_runs"("started_at");
CREATE INDEX "temporal_consolidation_runs_status_started_at_idx"
  ON "temporal_consolidation_runs"("status", "started_at");
CREATE INDEX "messages_temporal_search_idx"
  ON "messages" USING GIN (to_tsvector('simple'::regconfig, "content"));
