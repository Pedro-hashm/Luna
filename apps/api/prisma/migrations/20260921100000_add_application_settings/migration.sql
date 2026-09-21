CREATE TABLE "application_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "llm_combo" TEXT NOT NULL DEFAULT 'local-general',
    "orchestrator_combo" TEXT NOT NULL DEFAULT 'local-general',
    "app_timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "llm_temperature" DOUBLE PRECISION,
    "llm_max_tokens" INTEGER,
    "retrieval_default_top_k" INTEGER NOT NULL DEFAULT 8,
    "retrieval_max_top_k" INTEGER NOT NULL DEFAULT 50,
    "retrieval_default_max_context_tokens" INTEGER NOT NULL DEFAULT 8000,
    "retrieval_max_context_tokens" INTEGER NOT NULL DEFAULT 20000,
    "retrieval_include_messages" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_settings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "application_settings_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "application_settings_limits_check" CHECK (
        length(trim("llm_combo")) > 0
        AND length(trim("orchestrator_combo")) > 0
        AND length(trim("app_timezone")) > 0
        AND ("llm_temperature" IS NULL OR ("llm_temperature" >= 0 AND "llm_temperature" <= 2))
        AND ("llm_max_tokens" IS NULL OR "llm_max_tokens" > 0)
        AND "retrieval_default_top_k" > 0
        AND "retrieval_max_top_k" >= "retrieval_default_top_k"
        AND "retrieval_default_max_context_tokens" > 0
        AND "retrieval_max_context_tokens" >= "retrieval_default_max_context_tokens"
    )
);

INSERT INTO "application_settings" (
    "id",
    "llm_combo",
    "orchestrator_combo",
    "app_timezone",
    "retrieval_default_top_k",
    "retrieval_max_top_k",
    "retrieval_default_max_context_tokens",
    "retrieval_max_context_tokens",
    "retrieval_include_messages"
)
VALUES (1, 'local-general', 'local-general', 'America/Sao_Paulo', 8, 50, 8000, 20000, true)
ON CONFLICT ("id") DO NOTHING;
