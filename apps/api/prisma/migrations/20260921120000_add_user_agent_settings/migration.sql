ALTER TABLE "application_settings"
ADD COLUMN "immediate_context_max_tokens" INTEGER NOT NULL DEFAULT 32000,
ADD COLUMN "orchestrator_max_iterations" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN "orchestrator_max_tool_calls" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "application_settings"
DROP CONSTRAINT "application_settings_limits_check";

ALTER TABLE "application_settings"
ADD CONSTRAINT "application_settings_limits_check" CHECK (
    length(trim("llm_combo")) > 0
    AND length(trim("orchestrator_combo")) > 0
    AND length(trim("app_timezone")) > 0
    AND ("llm_temperature" IS NULL OR ("llm_temperature" >= 0 AND "llm_temperature" <= 2))
    AND ("llm_max_tokens" IS NULL OR "llm_max_tokens" > 0)
    AND "immediate_context_max_tokens" > 0
    AND "orchestrator_max_iterations" > 0
    AND "orchestrator_max_tool_calls" > 0
    AND "retrieval_default_top_k" > 0
    AND "retrieval_max_top_k" >= "retrieval_default_top_k"
    AND "retrieval_default_max_context_tokens" > 0
    AND "retrieval_max_context_tokens" >= "retrieval_default_max_context_tokens"
);
