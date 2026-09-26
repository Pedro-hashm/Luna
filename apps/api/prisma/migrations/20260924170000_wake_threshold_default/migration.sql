-- Keep new installations at the threshold measured for the provisional Luna
-- model. Existing user-selected thresholds are left untouched.
ALTER TABLE "application_settings"
  ALTER COLUMN "wake_threshold" SET DEFAULT 0.97;
