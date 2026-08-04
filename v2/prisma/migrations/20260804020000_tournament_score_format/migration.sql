-- Format skor turnamen: "single" (1 game sampai 30, default) atau "bo3" (rally 21, best of 3 game).
-- Skor lama berbentuk {a,b} dinormalisasi jadi satu game "single" di lapisan domain.
ALTER TABLE "tournaments" ADD COLUMN "score_format" TEXT NOT NULL DEFAULT 'single';
