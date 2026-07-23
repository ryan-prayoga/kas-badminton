"use client";

import { periodLabel } from "@/lib/format";
import { KIcon } from "@/components/kok/icons";

export function PeriodFilter({
  value,
  periods,
  onChange,
}: {
  value: string;
  periods: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft shadow-card focus-within:border-court/50">
      <KIcon name="calendar" className="size-3.5 text-ink-faint" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter periode"
        className="min-w-0 bg-transparent text-ink outline-none"
      >
        <option value="all">Semua waktu</option>
        {periods.map((k) => (
          <option key={k} value={k}>
            {periodLabel(k)}
          </option>
        ))}
      </select>
    </label>
  );
}
