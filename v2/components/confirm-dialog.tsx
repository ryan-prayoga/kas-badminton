"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tombol OK gaya destructive (default true) */
  destructive?: boolean;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

function normalize(options: ConfirmOptions | string): ConfirmOptions {
  return typeof options === "string" ? { message: options } : options;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ message: "" });
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    // tutup request sebelumnya (anggap batal) biar gak hang
    resolveRef.current?.(false);
    setOpts(normalize(options));
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  const finish = useCallback((value: boolean) => {
    setOpen(false);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(value);
  }, []);

  const destructive = opts.destructive !== false;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) finish(false);
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-w-[340px] gap-0 rounded-xl2 border border-line bg-surface p-0 shadow-pop ring-0 sm:max-w-[340px]"
        >
          <DialogHeader className="gap-3 p-4 pb-2">
            <div className="flex items-start gap-2.5">
              <span
                className={
                  destructive
                    ? "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-danger/12 text-danger"
                    : "mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-court/12 text-court"
                }
              >
                <AlertTriangle className="size-4" />
              </span>
              <div className="min-w-0 space-y-1">
                <DialogTitle className="font-display text-base font-bold tracking-tight text-ink">
                  {opts.title ?? "Konfirmasi"}
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed text-ink-soft">
                  {opts.message}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0 flex-row gap-2 border-t-0 bg-transparent p-4 pt-2 sm:justify-stretch">
            <button
              type="button"
              onClick={() => finish(false)}
              className="inline-flex h-10 flex-1 items-center justify-center rounded-xl border border-line bg-surface text-sm font-semibold text-ink shadow-card transition active:scale-95"
            >
              {opts.cancelLabel ?? "Batal"}
            </button>
            <button
              type="button"
              onClick={() => finish(true)}
              className={cn(
                "inline-flex h-10 flex-1 items-center justify-center rounded-xl text-sm font-bold text-white transition active:scale-95",
                destructive ? "bg-danger shadow-card" : "bg-court shadow-court",
              )}
            >
              {opts.confirmLabel ?? "Ya, lanjut"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm harus dipakai di dalam ConfirmProvider");
  }
  return ctx;
}
