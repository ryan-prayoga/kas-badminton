import Link from "next/link";
import { KIcon } from "@/components/kok/icons";

export function AppFrame({
  eyebrow,
  right,
  children,
}: {
  eyebrow: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-[600px] flex-col gap-4 px-4"
      style={{
        paddingTop: "calc(14px + var(--safe-t))",
        paddingBottom: "calc(104px + var(--safe-b))",
      }}
    >
      <header className="flex items-center justify-between gap-3 rounded-xl2 border border-line bg-surface p-4 shadow-card">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-court text-white shadow-court">
            <KIcon name="racket" className="size-6" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-faint">
              {eyebrow}
            </p>
            <h1 className="font-display truncate text-xl font-extrabold leading-tight tracking-tight text-ink">
              Kok Badminton
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {right ?? (
            <Link
              href="/admin"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-court px-3 py-2 text-sm font-semibold text-white shadow-court transition hover:bg-court-deep active:scale-95"
            >
              <KIcon name="shield" className="size-4" />
              Admin
            </Link>
          )}
        </div>
      </header>

      {children}

      <footer className="pb-1 pt-2 text-center text-xs text-ink-faint">
        Kok Badminton · dibuat buat patungan yang rapi
      </footer>
    </div>
  );
}
