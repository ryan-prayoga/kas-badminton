"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { PlayerRow } from "@/lib/domain/types";
import { deletePlayerAction, updatePlayerAction } from "@/server/actions/players";
import { useConfirm } from "@/components/confirm-dialog";
import { Avatar } from "@/components/kok/avatar";
import { KIcon } from "@/components/kok/icons";
import { Card } from "@/components/ui/card";
import { compressPhoto, ImageCompressError } from "@/lib/image-compress";

function PlayerRowItem({ player }: { player: PlayerRow }) {
  const confirm = useConfirm();
  const [name, setName] = useState(player.name);
  const [pending, start] = useTransition();
  const [compressing, setCompressing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // list pakai key={player.name} → remount otomatis kalau rename remote

  const rename = () => {
    const n = name.trim();
    if (!n || n === player.name) return;
    start(async () => {
      const res = await updatePlayerAction(player.name, { name: n });
      if (res.ok) toast.success("Nama diperbarui");
      else toast.error(res.error);
    });
  };

  // Foto dikompres di client dulu (lihat lib/image-compress) — foto kamera HP
  // gede-gede, jadi user gak perlu mikirin ukuran file sama sekali.
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setCompressing(true);
    let dataUrl: string;
    try {
      dataUrl = await compressPhoto(file);
    } catch (e) {
      toast.error(e instanceof ImageCompressError ? e.message : "Foto gagal diproses");
      return;
    } finally {
      setCompressing(false);
      // reset biar milih file yang sama lagi tetap ngetrigger onChange
      if (fileRef.current) fileRef.current.value = "";
    }
    start(async () => {
      const res = await updatePlayerAction(player.name, { photo: dataUrl });
      if (res.ok) toast.success("Foto diperbarui");
      else toast.error(res.error);
    });
  };

  const clearPhoto = async () => {
    const ok = await confirm({
      title: "Hapus foto?",
      message: `Foto ${player.name} akan dihapus. Bisa diunggah lagi kapan saja.`,
      confirmLabel: "Ya, hapus",
    });
    if (!ok) return;
    start(async () => {
      const res = await updatePlayerAction(player.name, { photo: null });
      if (res.ok) toast.success("Foto dihapus");
      else toast.error(res.error);
    });
  };

  const removePlayer = async () => {
    const ok = await confirm({
      title: "Hapus pemain?",
      message: `${player.name} akan dihapus dari daftar pemain. Riwayat game & pembayaran yang sudah ada tetap tersimpan.`,
      confirmLabel: "Ya, hapus",
    });
    if (!ok) return;
    start(async () => {
      const res = await deletePlayerAction(player.name);
      if (res.ok) toast.success("Pemain dihapus");
      else toast.error(res.error);
    });
  };

  return (
    <Card className="flex-row items-center gap-3 p-3">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={compressing}
        className="relative shrink-0"
        aria-label="Ganti foto"
      >
        <Avatar name={player.name} photo={player.photo} size="size-11" />
        <span className="absolute -bottom-1 -right-1 grid size-5 place-items-center rounded-full bg-court text-white ring-2 ring-surface">
          {compressing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <KIcon name="camera" className="size-3" />
          )}
        </span>
      </button>
      {/* image/* biar iOS ngasih opsi kamera + HEIC dari galeri; formatnya
          dinormalisasi ke JPEG waktu dikompres. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => void pickPhoto(e.target.files?.[0])}
      />

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="min-w-0 flex-1 rounded-xl border border-input bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-court/50"
      />

      {name.trim() !== player.name ? (
        <button
          type="button"
          onClick={rename}
          disabled={pending}
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-court text-white shadow-court active:scale-95"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <KIcon name="save" className="size-4" />}
        </button>
      ) : player.photo ? (
        <button
          type="button"
          onClick={clearPhoto}
          disabled={pending}
          className="grid size-9 shrink-0 place-items-center rounded-xl border border-line text-ink-faint hover:text-danger"
          aria-label="Hapus foto"
        >
          <KIcon name="trash" className="size-4" />
        </button>
      ) : null}

      <button
        type="button"
        onClick={removePlayer}
        disabled={pending}
        className="grid size-9 shrink-0 place-items-center rounded-xl border border-line text-ink-faint hover:border-danger/50 hover:text-danger"
        aria-label={`Hapus pemain ${player.name}`}
      >
        <KIcon name="accountRemove" className="size-4" />
      </button>
    </Card>
  );
}

export function PlayersPanel({ players }: { players: PlayerRow[] }) {
  if (!players.length) {
    return <p className="py-6 text-center text-sm text-ink-soft">Belum ada pemain.</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <p className="shrink-0 px-1 text-xs text-ink-soft">
        Ketuk foto buat ganti · edit nama lalu simpan.
      </p>
      {/* Hanya list yang scroll — header sheet + hint tetap.
          p-px: ruang 1px biar border kartu gak kepotong overflow-y-auto */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="space-y-2 p-px">
          {players.map((p) => (
            <PlayerRowItem key={p.name} player={p} />
          ))}
        </div>
      </div>
    </div>
  );
}
