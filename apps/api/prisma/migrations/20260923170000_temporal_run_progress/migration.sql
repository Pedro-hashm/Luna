ALTER TABLE "temporal_consolidation_runs"
  ADD COLUMN "current_phase" TEXT,
  ADD COLUMN "current_phase_started_at" TIMESTAMP(3),
  ADD COLUMN "progress_updated_at" TIMESTAMP(3),
  ADD COLUMN "phase_durations_ms" JSONB NOT NULL DEFAULT '{}'::jsonb;
