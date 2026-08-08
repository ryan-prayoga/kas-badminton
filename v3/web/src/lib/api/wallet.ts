// Klien tipis dompet deposit (API.md §4 "Deposit", F6/1) — GET jurnal
// (sendiri/bendahara), top-up & tarik (bendahara). Dipakai klub/kas
// (F6/6+).
import { api } from './client';

export type WalletEntry = {
	id: string;
	kind: 'topup' | 'pemakaian' | 'refund' | 'penyesuaian';
	amount: number;
	note?: string;
	created_at: string;
};

export type Wallet = { balance: number; entries: WalletEntry[] };

export function fetchMyWallet(clubId: string): Promise<Wallet> {
	return api.get<Wallet>(`/clubs/${clubId}/me/wallet`);
}

export function fetchMemberWallet(clubId: string, userId: string): Promise<Wallet> {
	return api.get<Wallet>(`/clubs/${clubId}/wallet/${userId}`);
}

// topup/withdraw ONLINE-ONLY (bukan lewat outbox) — uang beneran berpindah
// saat ini juga, bendahara harus tahu seketika kalau gagal (PLAN.md §11
// contoh eksplisit "verifikasi pembayaran bendahara").
export function topupWallet(clubId: string, userId: string, amount: number, note?: string) {
	return api.post(`/clubs/${clubId}/wallet/${userId}/topup`, { amount, note });
}

export function withdrawWallet(clubId: string, userId: string, amount: number, note?: string) {
	return api.post(`/clubs/${clubId}/wallet/${userId}/withdraw`, { amount, note });
}
