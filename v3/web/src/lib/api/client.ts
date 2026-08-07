// Klien REST tipis buat /api/v1 (API.md §0). Satu tempat yang tahu bentuk
// galat seragam, header Authorization, dan Idempotency-Key — supaya
// pemanggilnya (routes/*) cuma perlu peduli data, bukan transport.
import { getToken } from '$lib/stores/session.svelte';

const BASE = '/api/v1';

export class ApiError extends Error {
	code: string;
	detail: unknown;
	constructor(code: string, message: string, detail?: unknown) {
		super(message);
		this.code = code;
		this.detail = detail;
	}
}

type RequestOpts = {
	method?: string;
	body?: unknown;
	ifMatch?: number;
	query?: Record<string, string | undefined>;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
	const method = opts.method ?? 'GET';
	const headers = new Headers({ 'Content-Type': 'application/json' });

	const token = getToken();
	if (token) headers.set('Authorization', `Bearer ${token}`);

	// Idempotency-Key wajib di semua method selain GET (invarian §3.3).
	if (method !== 'GET' && method !== 'HEAD') {
		headers.set('Idempotency-Key', crypto.randomUUID());
	}
	if (opts.ifMatch != null) headers.set('If-Match', String(opts.ifMatch));

	let url = BASE + path;
	if (opts.query) {
		const qs = new URLSearchParams();
		for (const [k, v] of Object.entries(opts.query)) if (v != null) qs.set(k, v);
		const s = qs.toString();
		if (s) url += (url.includes('?') ? '&' : '?') + s;
	}

	const res = await fetch(url, {
		method,
		headers,
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
	});

	if (res.status === 204) return undefined as T;

	const isJSON = (res.headers.get('content-type') ?? '').includes('application/json');
	if (!res.ok) {
		if (isJSON) {
			const body = await res.json().catch(() => ({}));
			throw new ApiError(
				body?.error?.code ?? 'unknown',
				body?.error?.message ?? 'Terjadi galat. Coba lagi.',
				body?.error?.detail
			);
		}
		throw new ApiError('unknown', `Permintaan gagal (${res.status}).`);
	}

	return isJSON ? res.json() : ((await res.blob()) as unknown as T);
}

export const api = {
	get: <T>(path: string, query?: Record<string, string | undefined>) =>
		request<T>(path, { query }),
	post: <T>(path: string, body?: unknown, query?: Record<string, string | undefined>) =>
		request<T>(path, { method: 'POST', body, query }),
	patch: <T>(path: string, body?: unknown, ifMatch?: number) =>
		request<T>(path, { method: 'PATCH', body, ifMatch }),
	del: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};
