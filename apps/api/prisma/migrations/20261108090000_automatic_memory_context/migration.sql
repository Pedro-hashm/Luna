ALTER TABLE "memory_settings"
ADD COLUMN "fixedContextMaxTokens" INTEGER NOT NULL DEFAULT 512
CHECK ("fixedContextMaxTokens" BETWEEN 0 AND 4096);

CREATE TABLE "memory_recalls" (
  "itemId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "conversationId" UUID NOT NULL REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "requestHash" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("itemId", "revision", "conversationId"),
  FOREIGN KEY ("itemId", "revision") REFERENCES "memory_revisions"("itemId", "number") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "memory_recalls_usedAt_idx" ON "memory_recalls" ("usedAt");
CREATE INDEX "memory_recalls_conversationId_idx" ON "memory_recalls" ("conversationId");
