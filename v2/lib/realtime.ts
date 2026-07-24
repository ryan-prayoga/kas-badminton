// Realtime pub/sub via Postgres LISTEN/NOTIFY → fan-out ke SSE subscribers.
// Satu client pg khusus LISTEN (persistent), pool terpisah buat NOTIFY.
// Tanpa Redis. Lintas-proses aman (semua nyambung ke PG yang sama).
// LISTEN auto-reconnect selama masih ada subscriber.

import "server-only";
import { Client, Pool } from "pg";

const CHANNEL = "kok";
const RECONNECT_MS = 2000;
type Listener = (payload: string) => void;

interface RealtimeState {
  listeners: Set<Listener>;
  listenClient?: Client;
  notifyPool?: Pool;
  starting?: Promise<void>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

const g = globalThis as unknown as { __kokRealtime?: RealtimeState };
const state: RealtimeState = g.__kokRealtime ?? (g.__kokRealtime = { listeners: new Set() });

function clearListenClient(client?: Client) {
  if (client && state.listenClient === client) state.listenClient = undefined;
  else if (!client) state.listenClient = undefined;
  state.starting = undefined;
}

function scheduleReconnect() {
  if (state.reconnectTimer) return;
  if (state.listeners.size === 0) return;
  if (state.listenClient || state.starting) return;

  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = undefined;
    if (state.listeners.size === 0) return;
    void startRealtime().catch(() => {
      scheduleReconnect();
    });
  }, RECONNECT_MS);
}

async function connectListener(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  const onDrop = () => {
    try {
      client.removeAllListeners();
    } catch {
      /* noop */
    }
    clearListenClient(client);
    scheduleReconnect();
  };

  client.on("notification", (msg) => {
    const payload = msg.payload ?? "update";
    for (const l of state.listeners) {
      try {
        l(payload);
      } catch {
        /* subscriber mati; diabaikan */
      }
    }
  });
  client.on("error", onDrop);
  client.on("end", onDrop);

  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  state.listenClient = client;
}

export async function startRealtime(): Promise<void> {
  if (state.listenClient) return;
  if (!state.starting) {
    state.starting = connectListener().catch((err) => {
      state.starting = undefined;
      scheduleReconnect();
      throw err;
    });
  }
  await state.starting;
}

export function subscribe(listener: Listener): () => void {
  state.listeners.add(listener);
  // pastikan LISTEN hidup begitu ada viewer
  if (!state.listenClient && !state.starting) {
    void startRealtime().catch(() => {
      /* reconnect timer ikut */
    });
  }
  return () => {
    state.listeners.delete(listener);
  };
}

function fanoutLocal(payload: string) {
  // salin Set dulu — listener bisa unsub di tengah (mis. session invalid → close)
  for (const l of [...state.listeners]) {
    try {
      l(payload);
    } catch {
      /* subscriber mati; diabaikan */
    }
  }
}

/** Broadcast event ke semua viewer. Dipanggil tiap mutasi.
 *  Local fan-out dulu (same-process instan, termasuk cek sesi revoke),
 *  lalu NOTIFY buat lintas-proses. LISTEN bisa nge-double; client debounce refresh.
 */
export async function publish(payload: string = "update"): Promise<void> {
  const body = String(payload).slice(0, 7000);
  fanoutLocal(body);

  const pool = (state.notifyPool ??= new Pool({ connectionString: process.env.DATABASE_URL }));
  try {
    await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, body]);
  } catch {
    /* notify gagal tidak boleh menggagalkan mutasi — local sudah di-fanout */
  }
}
