"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Avatar, type PhotoMap } from "@/components/kok/avatar";

export function PlayerNameInput({
  value,
  onChange,
  names,
  photoMap,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  names: string[];
  photoMap?: PhotoMap;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = names
    .filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q)
    .slice(0, 6);
  const selectedPhoto = value.trim() ? photoMap?.[value.trim()] : undefined;

  return (
    <div className="relative z-10">
      <div className="relative">
        {selectedPhoto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={selectedPhoto}
            alt=""
            className="pointer-events-none absolute left-2.5 top-1/2 size-6 -translate-y-1/2 rounded-full object-cover ring-1 ring-line-strong"
          />
        )}
        <input
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder={placeholder}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="words"
          className={cn(
            "w-full rounded-xl border border-input bg-surface py-2.5 text-sm text-ink outline-none focus:border-court/50",
            selectedPhoto ? "pr-3 pl-10" : "px-3",
            className,
          )}
        />
      </div>
      {open && matches.length > 0 && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 shadow-pop">
          {matches.map((n) => (
            <li key={n}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-ink transition hover:bg-court/8"
              >
                <Avatar name={n} photo={photoMap?.[n]} size="size-7" />
                <span className="min-w-0 flex-1 truncate">{n}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
