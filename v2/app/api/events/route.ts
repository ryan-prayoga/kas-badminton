import { getSession, SESSION_COOKIE } from "@/lib/auth";
import { startRealtime, subscribe } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_CHECK_MS = 2000;
const PING_MS = 25000;

function cookieValue(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== name) continue;
    const raw = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function clearSessionCookieHeader(secure: boolean): string {
  const base = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  return secure ? `${base}; Secure` : base;
}

// SSE: broadcast mutasi + push session-invalid begitu token gak valid lagi
// (revoke / expire / restart server) — client logout instan tanpa nunggu hit API.
export async function GET(req: Request) {
  await startRealtime();
  const encoder = new TextEncoder();

  const token = cookieValue(req.headers.get("cookie"), SESSION_COOKIE);
  const secure =
    (req.headers.get("x-forwarded-proto") ?? "").includes("https") ||
    new URL(req.url).protocol === "https:";

  // Cookie ada tapi sesi sudah mati sejak connect → langsung invalid + bersihin cookie.
  const deadOnConnect = Boolean(token && !getSession(token));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const timers: {
        ping?: ReturnType<typeof setInterval>;
        sessionTick?: ReturnType<typeof setInterval>;
        expire?: ReturnType<typeof setTimeout>;
      } = {};
      let unsub: () => void = () => {};

      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* stream sudah ditutup */
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (timers.ping) clearInterval(timers.ping);
        if (timers.sessionTick) clearInterval(timers.sessionTick);
        if (timers.expire) clearTimeout(timers.expire);
        unsub();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };

      const emitSessionInvalid = () => {
        safeEnqueue("event: session\ndata: invalid\n\n");
        close();
      };

      /** true = sesi masih OK (atau viewer publik tanpa cookie). */
      const sessionOk = (): boolean => {
        if (!token) return true;
        return getSession(token) !== null;
      };

      const armExpireTimer = () => {
        if (timers.expire) clearTimeout(timers.expire);
        timers.expire = undefined;
        if (!token) return;
        const sess = getSession(token);
        if (!sess) return;
        const ms = sess.expiresAt - Date.now();
        // setTimeout max ~24.8 hari; clamp biar aman
        const wait = Math.max(0, Math.min(ms + 50, 2_147_000_000));
        timers.expire = setTimeout(() => {
          if (!sessionOk()) emitSessionInvalid();
        }, wait);
      };

      safeEnqueue("retry: 3000\n\n");
      req.signal.addEventListener("abort", close);

      if (deadOnConnect) {
        safeEnqueue("event: session\ndata: invalid\n\n");
        // biar event sempat flush sebelum stream ditutup
        setTimeout(close, 0);
        return;
      }

      safeEnqueue("event: ready\ndata: ok\n\n");
      armExpireTimer();

      unsub = subscribe((payload) => {
        // tiap mutasi (termasuk revoke operator) → cek sesi dulu
        if (!sessionOk()) {
          emitSessionInvalid();
          return;
        }
        armExpireTimer();
        safeEnqueue(`data: ${payload}\n\n`);
      });

      timers.ping = setInterval(() => safeEnqueue(": ping\n\n"), PING_MS);

      // backup: expire / revoke di proses yang sama tanpa lewat NOTIFY
      timers.sessionTick = setInterval(() => {
        if (!sessionOk()) emitSessionInvalid();
      }, SESSION_CHECK_MS);
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (deadOnConnect) {
    headers["Set-Cookie"] = clearSessionCookieHeader(secure);
  }

  return new Response(stream, { headers });
}
