ALTER TABLE "application_settings"
  ALTER COLUMN "temporal_consolidation_default_combo" SET DEFAULT 'local-general',
  ALTER COLUMN "temporal_consolidation_fallback_combo" SET DEFAULT 'paid-general';

UPDATE "application_settings"
SET "temporal_consolidation_default_combo" = 'local-general',
    "temporal_consolidation_fallback_combo" = 'paid-general'
WHERE "id" = 1
  AND "temporal_consolidation_default_combo" IS NULL
  AND "temporal_consolidation_fallback_combo" IS NULL;
