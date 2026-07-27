-- AlterTable
ALTER TABLE "payments" ADD COLUMN "type" TEXT NOT NULL DEFAULT 'lunas';
ALTER TABLE "payments" ADD COLUMN "recorded_by" TEXT;
ALTER TABLE "payments" ADD COLUMN "game_id" TEXT;
