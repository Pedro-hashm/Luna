ALTER TABLE "application_settings"
ADD COLUMN "conversation_evidence_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "conversation_evidences" (
    "id" UUID NOT NULL,
    "sequence" SERIAL NOT NULL,
    "message_id" UUID NOT NULL,
    "source_type" TEXT NOT NULL DEFAULT 'conversation_retrieval',
    "date_from" TIMESTAMPTZ(3) NOT NULL,
    "date_to" TIMESTAMPTZ(3) NOT NULL,
    "dates" TEXT[] NOT NULL,
    "time_zone" TEXT NOT NULL,
    "source_references" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_evidences_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_evidences_sequence_key" ON "conversation_evidences"("sequence");
CREATE INDEX "conversation_evidences_message_id_created_at_idx" ON "conversation_evidences"("message_id", "created_at");
ALTER TABLE "conversation_evidences"
ADD CONSTRAINT "conversation_evidences_message_id_fkey"
FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
