"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { login } from "@/server/actions/auth";
import { KIcon } from "@/components/kok/icons";
import { cn } from "@/lib/utils";

const LEN = 6;

export function Lockscreen() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array(LEN).fill(""));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const submit = (pin: string) => {
    startTransition(async () => {
      const res = await login(pin);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
        setDigits(Array(LEN).fill(""));
        refs.current[0]?.focus();
      }
    });
  };

  const onChange = (i: number, v: string) => {
    const chars = v.replace(/\D/g, "");
    const next = [...digits];
    if (!chars) {
      next[i] = "";
      setDigits(next);
      return;
    }
    let k = i;
    for (const c of chars) {
      if (k > LEN - 1) break;
      next[k] = c;
      k++;
    }
    setDigits(next);
    setError("");
    refs.current[Math.min(k, LEN - 1)]?.focus();
    const joined = next.join("");
    if (joined.length === LEN && next.every((d) => d)) submit(joined);
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, LEN);
    if (!text) return;
    e.preventDefault();
    const next = Array(LEN)
      .fill("")
      .map((_, i) => text[i] ?? "");
    setDigits(next);
    if (text.length === LEN) submit(text);
    else refs.current[text.length]?.focus();
  };

  return (
    <div className="relative mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-7 px-6">
      <Link
        href="/"
        className="absolute left-4 top-[calc(16px+var(--safe-t))] inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink-soft shadow-card transition hover:text-court active:scale-95"
      >
        <KIcon name="back" className="size-4" /> Kembali
      </Link>
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-16 place-items-center rounded-3xl bg-court text-white shadow-court">
          <KIcon name="racket" className="size-9" />
        </span>
        <div>
          <h1 className="font-display flex items-center justify-center gap-1.5 text-xl font-extrabold tracking-tight text-ink">
            <KIcon name="lock" className="size-5 text-ink-soft" /> Masuk Admin
          </h1>
          <p className="mt-1 text-sm text-ink-soft">Masukkan PIN 6 digit</p>
        </div>
      </div>

      <div className="flex gap-2.5" onPaste={onPaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            inputMode="numeric"
            maxLength={1}
            value={d}
            disabled={pending}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            className={cn(
              "font-display size-13 rounded-2xl border-2 bg-surface text-center text-2xl font-bold text-ink shadow-card outline-none transition-colors focus:border-court focus:ring-4 focus:ring-court/15",
              error ? "border-danger" : "border-line-strong",
            )}
            style={{ width: "3rem", height: "3.25rem" }}
          />
        ))}
      </div>

      <div className="h-5 text-sm">
        {pending ? (
          <span className="flex items-center gap-1.5 text-ink-soft">
            <Loader2 className="size-4 animate-spin" /> Memeriksa…
          </span>
        ) : error ? (
          <span className="font-medium text-danger">{error}</span>
        ) : null}
      </div>
    </div>
  );
}
