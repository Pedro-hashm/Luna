ALTER TABLE "application_settings"
  ADD COLUMN "research_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "research_search_orchestrator_combo" TEXT NOT NULL DEFAULT 'local-reasoning',
  ADD COLUMN "research_default_mode" TEXT NOT NULL DEFAULT 'quick',
  ADD COLUMN "research_default_recency" TEXT NOT NULL DEFAULT 'auto',
  ADD COLUMN "research_max_sources" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "research_max_rounds" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "research_max_queries" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "research_search_provider" TEXT NOT NULL DEFAULT 'searxng',
  ADD COLUMN "research_extraction_provider" TEXT NOT NULL DEFAULT 'static-with-browser-fallback',
  ADD COLUMN "research_cache_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "research_browser_fallback_enabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "research_runs" (
  "id" UUID PRIMARY KEY,
  "conversation_id" UUID,
  "message_id" UUID,
  "request_id" TEXT,
  "question" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "planner_combo" TEXT NOT NULL,
  "summary_context" TEXT,
  "metadata" JSONB,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  CONSTRAINT "research_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "research_runs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "research_runs_conversation_id_started_at_idx" ON "research_runs"("conversation_id", "started_at");
CREATE INDEX "research_runs_message_id_idx" ON "research_runs"("message_id");

CREATE TABLE "research_events" (
  "id" UUID PRIMARY KEY,
  "run_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "research_events_run_id_sequence_key" ON "research_events"("run_id", "sequence");
CREATE INDEX "research_events_run_id_created_at_idx" ON "research_events"("run_id", "created_at");

CREATE TABLE "research_sources" (
  "id" TEXT NOT NULL,
  "run_id" UUID NOT NULL,
  "normalized_url" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "source_type" TEXT NOT NULL,
  "rank" INTEGER,
  "published_at" TIMESTAMP(3),
  "retrieved_at" TIMESTAMP(3) NOT NULL,
  "extraction_method" TEXT,
  "metadata" JSONB,
  CONSTRAINT "research_sources_pkey" PRIMARY KEY ("run_id", "id"),
  CONSTRAINT "research_sources_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "research_sources_run_id_normalized_url_key" ON "research_sources"("run_id", "normalized_url");
CREATE INDEX "research_sources_run_id_idx" ON "research_sources"("run_id");

CREATE TABLE "research_evidence" (
  "id" TEXT PRIMARY KEY,
  "run_id" UUID NOT NULL,
  "source_id" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "location" TEXT,
  "type" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "research_evidence_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "research_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "research_evidence_run_id_source_id_fkey" FOREIGN KEY ("run_id", "source_id") REFERENCES "research_sources"("run_id", "id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "research_evidence_run_id_idx" ON "research_evidence"("run_id");
CREATE INDEX "research_evidence_source_id_idx" ON "research_evidence"("source_id");
