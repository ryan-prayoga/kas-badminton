export function SkeletonPanel() {
  return (
    <div className="mx-auto flex w-full max-w-[600px] flex-col gap-4 px-4 pt-4">
      <div className="flex items-center gap-3 rounded-xl2 border border-line bg-surface p-4 shadow-card">
        <div className="skeleton size-11 rounded-2xl" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-2.5 w-24" />
          <div className="skeleton h-4 w-40" />
        </div>
      </div>
      <div className="rounded-xl2 border border-line bg-surface p-4 shadow-card">
        <div className="mb-3 flex items-center justify-between">
          <div className="skeleton h-5 w-28" />
          <div className="skeleton h-7 w-28 rounded-full" />
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-xl2 border border-line bg-surface-2/60 p-3.5">
              <div className="skeleton mb-3 h-4 w-32" />
              <div className="grid grid-cols-2 gap-3">
                <div className="skeleton h-16 rounded-xl" />
                <div className="skeleton h-16 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
