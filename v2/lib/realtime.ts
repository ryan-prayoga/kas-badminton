// Realtime pub/sub via Postgres LISTEN/NOTIFY → fan-out ke SSE subscribers.
// Satu client pg khusus LISTEN (persistent), pool terpisah buat NOTIFY.
// Tanpa Redis. Lintas-proses aman (semua nyambung ke PG yang sama).

import "server-only";
import { Client, Pool } from "pg";

const CHANNEL = "kok";
type Listener = (payload: string) => void;

interface RealtimeState {
  listeners: Set<Listener>;
  listenClient?: Client;
  notifyPool?: Pool;
  starting?: Promise<void>;
}

const g = globalThis as unknown as { __kokRealtime?: RealtimeState };
const state: RealtimeState = g.__kokRealtime ?? (g.__kokRealtime = { listeners: new Set() });

async function connectListener(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
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
  client.on("error", () => {
    // koneksi putus → reset supaya subscribe berikutnya reconnect
    state.listenClient = undefined;
    state.starting = undefined;
  });
  await client.connect();
  await client.query(`LISTEN ${CHANNEL}`);
  state.listenClient = client;
}

export async function startRealtime(): Promise<void> {
  if (state.listenClient) return;
  if (!state.starting) {
    state.starting = connectListener().catch((err) => {
      state.starting = undefined;
      throw err;
    });
  }
  await state.starting;
}

export function subscribe(listener: Listener): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

/** Broadcast event ke semua viewer. Dipanggil tiap mutasi. */
export async function publish(payload: string = "update"): Promise<void> {
  const pool = (state.notifyPool ??= new Pool({ connectionString: process.env.DATABASE_URL }));
  try {
    await pool.query("SELECT pg_notify($1, $2)", [CHANNEL, String(payload).slice(0, 7000)]);
  } catch {
    /* notify gagal tidak boleh menggagalkan mutasi */
  }
}
