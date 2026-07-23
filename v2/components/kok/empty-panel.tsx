import { KIcon, type IconName } from "@/components/kok/icons";

export function EmptyPanel({ icon, text }: { icon: IconName; text: string }) {
  return (
    <div className="grid place-items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface-2 py-10 text-ink-faint">
      <KIcon name={icon} className="size-8" />
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}
