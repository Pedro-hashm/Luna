ALTER TABLE "application_settings"
  ADD COLUMN "voice_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "voice_default_mode" TEXT NOT NULL DEFAULT 'wake',
  ADD COLUMN "voice_profile_id" TEXT NOT NULL DEFAULT 'pf_dora',
  ADD COLUMN "voice_tts_engine" TEXT NOT NULL DEFAULT 'kokoro',
  ADD COLUMN "voice_response_mode" TEXT NOT NULL DEFAULT 'concise',
  ADD COLUMN "voice_max_sentences" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "voice_max_words" INTEGER NOT NULL DEFAULT 70,
  ADD COLUMN "voice_barge_in_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "voice_speed" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "wake_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "wake_keyword" TEXT NOT NULL DEFAULT 'Luna',
  ADD COLUMN "wake_model" TEXT NOT NULL DEFAULT 'luna',
  ADD COLUMN "wake_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "wake_verifier_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "wake_verifier_model" TEXT,
  ADD COLUMN "wake_verifier_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN "stt_provider" TEXT NOT NULL DEFAULT 'speaches',
  ADD COLUMN "tts_provider" TEXT NOT NULL DEFAULT 'kokoro';

ALTER TABLE "messages"
  ADD COLUMN "input_mode" TEXT,
  ADD COLUMN "output_mode" TEXT;

UPDATE "messages" SET "input_mode" = 'text' WHERE "role" = 'user';
UPDATE "messages" SET "output_mode" = 'text' WHERE "role" = 'assistant';

CREATE TABLE "voice_sessions" (
  "id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "mode" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'idle',
  "metadata" JSONB DEFAULT '{}',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "voice_sessions_conversation_id_started_at_idx" ON "voice_sessions"("conversation_id", "started_at");

CREATE TABLE "voice_events" (
  "id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "type" TEXT NOT NULL,
  "data" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "voice_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "voice_events_session_id_created_at_idx" ON "voice_events"("session_id", "created_at");

CREATE TABLE "voice_profiles" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "engine" TEXT NOT NULL DEFAULT 'kokoro',
  "voice_id" TEXT NOT NULL,
  "language" TEXT,
  "source" TEXT NOT NULL DEFAULT 'builtin',
  "source_url" TEXT,
  "license" TEXT,
  "format" TEXT,
  "asset_path" TEXT,
  "metadata" JSONB DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "voice_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "voice_profiles_voice_id_key" ON "voice_profiles"("voice_id");
