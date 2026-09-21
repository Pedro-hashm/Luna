ALTER TABLE "application_settings"
ALTER COLUMN "orchestrator_tool_result_max_tokens" SET DEFAULT 1000;

-- Existing rows created before this safeguard used the original 4000-token
-- default. Preserve deliberate custom values while correcting that default.
UPDATE "application_settings"
SET "orchestrator_tool_result_max_tokens" = 1000
WHERE "orchestrator_tool_result_max_tokens" = 4000;
