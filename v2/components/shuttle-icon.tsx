import type { SVGProps } from "react";

/** Ikon kok/shuttlecock sederhana untuk brand. */
export function ShuttleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <circle cx="12" cy="18.5" r="3" fill="currentColor" stroke="none" />
      <path
        d="M12 15.5 5 6M12 15.5 19 6M12 15.5 9 5.5M12 15.5 15 5.5M12 15.5 12 5"
        strokeLinecap="round"
      />
      <path d="M6.5 8.2 17.5 8.2M8 5.8 16 5.8" strokeLinecap="round" opacity={0.5} />
    </svg>
  );
}
