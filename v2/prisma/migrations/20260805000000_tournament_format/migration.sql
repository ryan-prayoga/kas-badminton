-- Format turnamen: "knockout" (sistem gugur, default — sama seperti perilaku sebelumnya)
-- atau "round_robin" (semua lawan semua). `size` sekarang jumlah pasangan yang ikut (2–32);
-- knockout memadatkan sisa slot bagan jadi BYE di lapisan domain.
ALTER TABLE "tournaments" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'knockout';
