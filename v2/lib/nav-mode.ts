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

/**
 * Satu-satunya aturan "chrome-nya admin atau publik". Dipakai bareng BottomNav
 * dan SessionBadge — dulu masing-masing punya salinan sendiri dan sempat beda.
 *
 * Masih login = chrome admin, titik. Kecuali user sendiri yang milih
 * "Halaman publik" dari menu Lainnya (mode `public`). Rute `/admin*` selalu
 * chrome admin, apa pun modenya.
 *
 * Dulu ada klausa tambahan `pathname !== "/"` — bikin app yang dibuka dari home
 * screen (start_url `/`) nampil chrome publik walau masih login admin, terus
 * lompat ke chrome admin begitu pindah halaman. Bingungin, jadi dibuang.
 */
export function isAdminChrome(pathname: string, mode: NavMode, hasRole: boolean): boolean {
  if (!hasRole) return false;
  if (pathname.startsWith("/admin")) return true;
  return mode !== "public";
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
