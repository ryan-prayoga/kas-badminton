import { startRealtime, subscribe } from "@/lib/realtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE: broadcast satu-arah tiap ada mutasi. Client buka EventSource → router.refresh().
export async function GET(req: Request) {
  await startRealtime();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* stream sudah ditutup */
        }
      };

      safeEnqueue("retry: 3000\n\n");
      safeEnqueue("event: ready\ndata: ok\n\n");

      const unsub = subscribe((payload) => safeEnqueue(`data: ${payload}\n\n`));
      const ping = setInterval(() => safeEnqueue(": ping\n\n"), 25000);

      const close = () => {
        clearInterval(ping);
        unsub();
        try {
          controller.close();
        } catch {
          /* noop */
        }
      };
      req.signal.addEventListener("abort", close);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
