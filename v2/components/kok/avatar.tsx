import { cn } from "@/lib/utils";

type Tone = "court" | "paid" | "owe";

const TONE: Record<Tone, string> = {
  court: "bg-court/10 text-court",
  paid: "bg-paid/12 text-paid",
  owe: "bg-owe/12 text-owe",
};

export function Avatar({
  name,
  photo,
  size = "size-9",
  tone = "court",
}: {
  name: string;
  photo?: string | null;
  size?: string;
  tone?: Tone;
}) {
  if (photo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photo}
        alt=""
        className={cn(size, "shrink-0 rounded-full object-cover ring-1 ring-line-strong")}
      />
    );
  }
  return (
    <div
      className={cn(
        size,
        TONE[tone],
        "font-display grid shrink-0 place-items-center rounded-full font-bold",
      )}
    >
      {(name || "?").slice(0, 1).toUpperCase()}
    </div>
  );
}

export type PhotoMap = Record<string, string>;

export function buildPhotoMap(players: { name: string; photo: string | null }[]): PhotoMap {
  const map: PhotoMap = {};
  for (const p of players) if (p.name && p.photo) map[p.name] = p.photo;
  return map;
}
