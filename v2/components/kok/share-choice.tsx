"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  renderShareCard,
  shareImage,
  shareText,
  type ShareCardBlock,
} from "@/lib/share";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KIcon, type IconName } from "@/components/kok/icons";

export function ShareChoiceDialog({
  open,
  onOpenChange,
  title = "Bagikan",
  description = "Pilih format yang mau dikirim",
  text,
  imageBlocks,
  imageName = "kok-share.png",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  text: string;
  imageBlocks: ShareCardBlock[];
  imageName?: string;
}) {
  const [busy, setBusy] = useState<"text" | "image" | null>(null);

  const onText = async () => {
    setBusy("text");
    try {
      await shareText(text, title);
      onOpenChange(false);
    } catch {
      toast.error("Gagal bagikan teks");
    } finally {
      setBusy(null);
    }
  };

  const onImage = async () => {
    setBusy("image");
    try {
      const blob = await renderShareCard(imageBlocks);
      const mode = await shareImage(blob, imageName, title);
      if (mode === "downloaded") {
        toast.success("Gambar diunduh — kirim manual dari galeri/file");
      }
      onOpenChange(false);
    } catch {
      toast.error("Gagal buat gambar share");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton>
        <DialogHeader>
          <DialogTitle className="font-display text-lg font-bold">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 pt-1">
          <OptionButton
            icon="share"
            label="Bagikan teks"
            hint="WhatsApp / share sheet teks"
            onClick={onText}
            disabled={busy !== null}
            loading={busy === "text"}
          />
          <OptionButton
            icon="image"
            label="Bagikan gambar"
            hint="Kartu rapi, cocok story/chat"
            onClick={onImage}
            disabled={busy !== null}
            loading={busy === "image"}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OptionButton({
  icon,
  label,
  hint,
  onClick,
  disabled,
  loading,
}: {
  icon: IconName;
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2/70 px-3.5 py-3 text-left transition hover:border-court/30 hover:bg-court/5 active:scale-[0.99] disabled:opacity-50"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-court/10 text-court">
        <KIcon name={icon} className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold text-ink">{loading ? "Menyiapkan…" : label}</span>
        <span className="mt-0.5 block text-xs text-ink-faint">{hint}</span>
      </span>
      <KIcon name="chevronDown" className="size-4 -rotate-90 text-ink-faint" />
    </button>
  );
}
