// Klien tipis QRIS (API.md §4 "Kas & QRIS", F6/4). PUT butuh If-Match
// (invarian §3.4) — dipanggil dgn versi klub saat ini.
import { api } from './client';

export type Qris = { merchant_qris: string | null; version: number };

export function fetchQris(clubId: string): Promise<Qris> {
	return api.get<Qris>(`/clubs/${clubId}/qris`);
}

export function putQris(clubId: string, payload: string, version: number): Promise<Qris> {
	return api.put<Qris>(`/clubs/${clubId}/qris`, { payload }, version);
}

export type DynamicQris = { id: string; payload: string; expires_at: string };

// createDynamicQris — ONLINE-ONLY secara alami (bukan lewat outbox): QR
// dinamis harus fresh SEKARANG, mengantrenya offline tidak ada gunanya
// sama sekali (§9.6 "selalu dibuat ulang saat dialog dibuka").
export function createDynamicQris(clubId: string, amount: number): Promise<DynamicQris> {
	return api.post<DynamicQris>(`/clubs/${clubId}/qris/dynamic`, { amount });
}

export function reportQrisRejected(clubId: string, id: string): Promise<void> {
	return api.post(`/clubs/${clubId}/qris/dynamic/${id}/report-rejected`);
}
