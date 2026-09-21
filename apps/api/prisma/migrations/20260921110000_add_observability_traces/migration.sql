CREATE TYPE "ObservabilityTraceKind" AS ENUM ('llm', 'tool');
CREATE TYPE "ObservabilityTraceStatus" AS ENUM ('success', 'error', 'timeout');

CREATE TABLE "observability_traces" (
    "id" UUID NOT NULL,
    "request_id" TEXT,
    "conversation_id" UUID,
    "response_message_id" UUID,
    "kind" "ObservabilityTraceKind" NOT NULL,
    "status" "ObservabilityTraceStatus" NOT NULL,
    "tool_name" TEXT,
    "combo" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "stage_durations" JSONB,
    "context_snapshot" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "observability_traces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "observability_traces_response_message_id_key"
ON "observability_traces"("response_message_id");

CREATE INDEX "observability_traces_created_at_idx"
ON "observability_traces"("created_at");

CREATE INDEX "observability_traces_conversation_id_created_at_idx"
ON "observability_traces"("conversation_id", "created_at");

CREATE INDEX "observability_traces_kind_status_created_at_idx"
ON "observability_traces"("kind", "status", "created_at");

ALTER TABLE "observability_traces"
ADD CONSTRAINT "observability_traces_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "observability_traces"
ADD CONSTRAINT "observability_traces_response_message_id_fkey"
FOREIGN KEY ("response_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
