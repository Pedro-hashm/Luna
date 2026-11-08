ALTER TABLE "conversations"
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'web',
  ADD COLUMN "memory_scope" TEXT NOT NULL DEFAULT 'global',
  ADD COLUMN "source_key" TEXT,
  ADD COLUMN "source_user_id" TEXT,
  ADD COLUMN "source_guild_id" TEXT;

CREATE UNIQUE INDEX "conversations_source_key_key" ON "conversations"("source_key");
CREATE INDEX "conversations_source_memory_scope_idx" ON "conversations"("source", "memory_scope");

ALTER TABLE "discord_voice_settings"
  ADD COLUMN "owner_discord_user_id" TEXT;
