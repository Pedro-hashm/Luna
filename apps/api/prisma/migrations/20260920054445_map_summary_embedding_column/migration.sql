/*
  Warnings:

  - You are about to drop the column `summaryEmbedding` on the `conversations` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "conversations" DROP COLUMN "summaryEmbedding",
ADD COLUMN     "summary_embedding" vector;
