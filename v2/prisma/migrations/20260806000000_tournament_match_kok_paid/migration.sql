-- Status lunas kok per partai: Record<matchId, boolean[4]>, urutan [sisiA.a, sisiA.b, sisiB.a, sisiB.b].
-- Kok tiap partai sekarang ditagih ke 4 pemain partai itu saja (bukan rata ke semua peserta turnamen
-- lewat `fee`) — kolom ini nyimpen siapa yang sudah bayar bagiannya per partai.
ALTER TABLE "tournaments" ADD COLUMN "match_kok_paid" JSONB NOT NULL DEFAULT '{}';
