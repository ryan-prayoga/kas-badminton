-- Turnamen bisa lebih dari sehari: `date` jadi tanggal mulai, `end_date` tanggal selesai (null = sehari).
ALTER TABLE "tournaments" ADD COLUMN "end_date" TEXT;
