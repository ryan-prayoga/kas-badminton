"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function PlayerNameInput({
  value,
  onChange,
  names,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  names: string[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = names
    .filter((n) => n.toLowerCase().includes(q) && n.toLowerCase() !== q)
    .slice(0, 6);

  return (
    <div className="relative">
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
          "w-full rounded-xl border border-input bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-court/50",
          className,
        )}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
          {matches.map((n) => (
            <li key={n}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(n);
                  setOpen(false);
                }}
                className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm font-medium text-ink transition hover:bg-court/8"
              >
                {n}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
