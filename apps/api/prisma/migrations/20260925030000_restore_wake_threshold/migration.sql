-- Restore the prior provisional wake threshold at the user's request.
ALTER TABLE "application_settings"
  ALTER COLUMN "wake_threshold" SET DEFAULT 0.97;

UPDATE "application_settings"
SET "wake_threshold" = 0.97
WHERE "wake_threshold" = 0.5;
