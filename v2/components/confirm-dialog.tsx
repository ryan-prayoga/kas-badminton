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
import { Button } from "@/components/ui/button";
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
        <DialogContent showCloseButton={false} className="max-w-[360px] gap-0 p-0 sm:max-w-[360px]">
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
                <DialogTitle className="text-base font-bold tracking-tight">
                  {opts.title ?? "Konfirmasi"}
                </DialogTitle>
                <DialogDescription className="text-sm leading-relaxed text-ink-soft">
                  {opts.message}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogFooter className="flex-row gap-2 border-t-0 bg-transparent p-4 sm:justify-stretch">
            <Button
              type="button"
              variant="outline"
              className="h-10 flex-1 rounded-xl"
              onClick={() => finish(false)}
            >
              {opts.cancelLabel ?? "Batal"}
            </Button>
            <Button
              type="button"
              variant={destructive ? "destructive" : "default"}
              className="h-10 flex-1 rounded-xl font-bold"
              onClick={() => finish(true)}
            >
              {opts.confirmLabel ?? "Ya, lanjut"}
            </Button>
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
