ALTER TABLE "memory_settings" ALTER COLUMN "allowExplicitUse" SET DEFAULT true;

CREATE TABLE "memory_changes" (
  "id" UUID NOT NULL PRIMARY KEY,
  "messageId" UUID NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "itemKey" TEXT NOT NULL,
  "revisionId" UUID REFERENCES "memory_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "previousRevision" INTEGER,
  "previousValidTo" TEXT,
  "previousKind" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undoneAt" TIMESTAMP(3)
);

CREATE UNIQUE INDEX "memory_changes_messageId_itemKey_key" ON "memory_changes" ("messageId", "itemKey");
CREATE INDEX "memory_changes_revisionId_idx" ON "memory_changes" ("revisionId");
