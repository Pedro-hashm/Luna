CREATE TABLE "memory_settings" (
  "id" INTEGER PRIMARY KEY DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "suggestionsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "allowExplicitUse" BOOLEAN NOT NULL DEFAULT false
);
INSERT INTO "memory_settings" ("id") VALUES (1);

CREATE TABLE "memory_items" (
  "id" UUID PRIMARY KEY,
  "key" TEXT NOT NULL UNIQUE,
  "subject" TEXT NOT NULL,
  "predicate" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "allowModel" BOOLEAN NOT NULL DEFAULT false,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "memory_items_scope_archived_allowModel_idx" ON "memory_items" ("scope", "archived", "allowModel");

CREATE TABLE "memory_revisions" (
  "id" UUID PRIMARY KEY,
  "itemId" UUID NOT NULL REFERENCES "memory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "number" INTEGER NOT NULL,
  "value" TEXT NOT NULL,
  "validFrom" TEXT,
  "validTo" TEXT,
  "status" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "memory_revisions_itemId_number_key" UNIQUE ("itemId", "number")
);

CREATE TABLE "memory_sources" (
  "id" UUID PRIMARY KEY,
  "revisionId" UUID NOT NULL REFERENCES "memory_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "messageId" UUID NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "quote" TEXT NOT NULL,
  CONSTRAINT "memory_sources_revisionId_messageId_key" UNIQUE ("revisionId", "messageId")
);

CREATE TABLE "memory_suppressions" ("key" TEXT PRIMARY KEY, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "memory_suggestions" (
  "id" UUID PRIMARY KEY,
  "fingerprint" TEXT NOT NULL UNIQUE,
  "itemKey" TEXT NOT NULL,
  "expectedVersion" INTEGER,
  "messageId" UUID NOT NULL REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "draft" JSONB NOT NULL,
  "quote" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "memory_suggestions_itemKey_idx" ON "memory_suggestions" ("itemKey");

CREATE TABLE "memory_jobs" (
  "messageId" UUID PRIMARY KEY REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "availableAt" TIMESTAMP(3) NOT NULL,
  "leaseUntil" TIMESTAMP(3),
  "leaseToken" UUID,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "done" BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX "memory_jobs_done_availableAt_idx" ON "memory_jobs" ("done", "availableAt");
