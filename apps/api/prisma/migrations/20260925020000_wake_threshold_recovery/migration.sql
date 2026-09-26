-- The provisional wake model has no real positive recordings yet, so its
-- 0.97 evaluation threshold is not a reliable default for everyday use.
ALTER TABLE "application_settings"
  ALTER COLUMN "wake_threshold" SET DEFAULT 0.5;

-- Restore installations that inherited the provisional default while leaving
-- thresholds explicitly tuned to other values untouched.
UPDATE "application_settings"
SET "wake_threshold" = 0.5
WHERE "wake_threshold" = 0.97;
