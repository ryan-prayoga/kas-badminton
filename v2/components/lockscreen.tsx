"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { login } from "@/server/actions/auth";
import { KIcon } from "@/components/kok/icons";
import { cn } from "@/lib/utils";

const LEN = 6;

function formatClock(d: Date): string {
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
}

export function Lockscreen() {
  const router = useRouter();
  const [buffer, setBuffer] = useState("");
  const [error, setError] = useState("");
  const [shake, setShake] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clock, setClock] = useState(() => formatClock(new Date()));
  const pendingRef = useRef(false);
  const bufferRef = useRef("");

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);
  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 15_000);
    return () => clearInterval(id);
  }, []);

  const submit = useCallback(
    (pin: string) => {
      startTransition(async () => {
        const res = await login(pin);
        if (res.ok) {
          router.refresh();
        } else {
          setError(res.error);
          setBuffer("");
          bufferRef.current = "";
          setShake(true);
          window.setTimeout(() => setShake(false), 400);
        }
      });
    },
    [router],
  );

  const push = useCallback(
    (key: string) => {
      if (pendingRef.current) return;
      setError("");
      if (key === "back") {
        setBuffer((b) => {
          const next = b.slice(0, -1);
          bufferRef.current = next;
          return next;
        });
        return;
      }
      if (!/^\d$/.test(key)) return;
      const cur = bufferRef.current;
      if (cur.length >= LEN) return;
      const next = cur + key;
      bufferRef.current = next;
      setBuffer(next);
      if (next.length === LEN) submit(next);
    },
    [submit],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Backspace") {
        e.preventDefault();
        push("back");
      } else if (/^\d$/.test(e.key)) {
        e.preventDefault();
        push(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [push]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 pb-[calc(28px+env(safe-area-inset-bottom))] pt-[calc(28px+env(safe-area-inset-top))] text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-court/15 text-court ring-1 ring-court/30">
        <KIcon name="lock" className="size-7" />
      </span>

      <div className="font-mono text-5xl font-light tracking-tight tabular-nums text-ink">{clock}</div>
      <p className="text-sm text-ink-soft">Masukkan PIN</p>

      <div
        className={cn("flex gap-3.5", shake && "animate-shake")}
        aria-label={`${buffer.length} dari ${LEN} digit`}
      >
        {Array.from({ length: LEN }).map((_, i) => {
          const on = i < buffer.length;
          return (
            <span
              key={i}
              className={cn(
                "size-3 rounded-full border-[1.5px] transition",
                on ? "scale-110 border-court bg-court" : "border-ink-faint bg-transparent",
              )}
            />
          );
        })}
      </div>

      <div className="min-h-5 text-sm">
        {pending ? (
          <span className="inline-flex items-center gap-1.5 text-ink-soft">
            <Loader2 className="size-4 animate-spin" /> Memeriksa…
          </span>
        ) : error ? (
          <span className="font-medium text-danger">{error}</span>
        ) : (
          <span className="text-transparent">.</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {keys.map((key, i) => {
          if (!key) return <span key={`empty-${i}`} />;
          if (key === "back") {
            return (
              <button
                key="back"
                type="button"
                aria-label="Hapus"
                disabled={pending}
                onClick={() => push("back")}
                className="grid size-[72px] place-items-center rounded-full border border-line bg-surface text-ink-soft transition active:scale-95 active:bg-surface-2 disabled:opacity-50"
              >
                <KIcon name="backspace" className="size-6" />
              </button>
            );
          }
          return (
            <button
              key={key}
              type="button"
              disabled={pending}
              onClick={() => push(key)}
              className="size-[72px] rounded-full border border-line bg-surface text-2xl font-medium text-ink transition active:scale-95 active:bg-surface-2 disabled:opacity-50"
            >
              {key}
            </button>
          );
        })}
      </div>

      <Link
        href="/"
        className="mt-1 inline-flex items-center gap-1 text-sm text-ink-faint transition hover:text-ink-soft"
      >
        <KIcon name="back" className="size-4" /> Halaman publik
      </Link>
    </div>
  );
}
