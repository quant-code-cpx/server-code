-- Prisma @updatedAt writes this column explicitly and expects no database default.
ALTER TABLE "ai_conversations" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ai_messages" ALTER COLUMN "updated_at" DROP DEFAULT;
