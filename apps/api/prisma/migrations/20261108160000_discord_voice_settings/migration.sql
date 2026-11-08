CREATE TABLE "discord_voice_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "guild_id" TEXT,
    "channel_id" TEXT,
    CONSTRAINT "discord_voice_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "discord_voice_settings_singleton" CHECK ("id" = 1),
    CONSTRAINT "discord_voice_settings_destination" CHECK (
      ("channel_id" IS NULL OR "guild_id" IS NOT NULL)
      AND (NOT "enabled" OR ("guild_id" IS NOT NULL AND "channel_id" IS NOT NULL))
    )
);
