/** Status sesi di client — biar UI logout instan tanpa nunggu RSC refresh.
 *  Server push (SSE `session: invalid`) atau logout manual → set false.
 *  Login sukses / server masih kasih role → set true.
 */

const EVENT = "kok-session-alive";

let alive = true;

export function getSessionAlive(): boolean {
  return alive;
}

export function setSessionAlive(next: boolean): void {
  if (alive === next) return;
  alive = next;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT));
  }
}

export function subscribeSessionAlive(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}
