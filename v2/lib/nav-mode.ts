/** Preferensi chrome nav saat admin/operator masih login.
 *  `public` = browse halaman publik (tanpa FAB / Lainnya; Riwayat = `/`).
 *  `admin`  = chrome penuh (default saat login / masuk rute /admin*).
 */

export type NavMode = "admin" | "public";

const KEY = "kok-nav-mode";
const EVENT = "kok-nav-mode";

export function getNavMode(): NavMode {
  if (typeof window === "undefined") return "admin";
  try {
    return sessionStorage.getItem(KEY) === "public" ? "public" : "admin";
  } catch {
    return "admin";
  }
}

export function setNavMode(mode: NavMode): void {
  if (typeof window === "undefined") return;
  try {
    if (mode === "public") sessionStorage.setItem(KEY, "public");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* ignore quota / private mode */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeNavMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
