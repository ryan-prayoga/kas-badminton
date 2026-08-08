// Klien tipis payments/claim + cancel (API.md §4 "Pemain sendiri", F6/2)
// dan verify/reject (§4 "Bendahara") — dipakai PayDialog.svelte (klaim) dan
// klub/kas (verifikasi).
import { api } from './client';

export type PaymentMethod = 'qris_statis' | 'qris_dinamis' | 'transfer' | 'tunai' | 'deposit';

export type Payment = {
	id: string;
	user_id: string;
	amount: number;
	status: 'pending' | 'verified' | 'rejected';
	method?: PaymentMethod;
	claimed_at?: string;
	verified_by?: string;
	note?: string;
};

// claimPayment — "sudah transfer" (§9.3). ONLINE-ONLY (bukan lewat outbox):
// ini laporan bahwa uang SUDAH berpindah tangan, harus tahu seketika kalau
// gagal (mis. item sudah diklaim orang lain) — bukan diam-diam mengantre
// lalu gagal belakangan waktu pemain sudah menutup app.
export function claimPayment(
	clubId: string,
	input: { item_ids: string[]; amount: number; method?: PaymentMethod; note?: string }
): Promise<Payment> {
	return api.post<Payment>(`/clubs/${clubId}/payments/claim`, input);
}

export function cancelPayment(clubId: string, paymentId: string): Promise<Payment> {
	return api.post<Payment>(`/clubs/${clubId}/payments/claim/${paymentId}/cancel`);
}

// --- Bendahara (perm.ManageMoney) ---

export type ClubBillItem = {
	id: string;
	user_id: string;
	game_id: string;
	amount: number;
	played_on: string;
	status: 'unpaid' | 'pending_review' | 'disputed';
	payment_id?: string;
	claimed_at?: string;
};

export function listClubBills(clubId: string, status?: string): Promise<{ items: ClubBillItem[] }> {
	return api.get<{ items: ClubBillItem[] }>(`/clubs/${clubId}/bills`, status ? { status } : undefined);
}

export function verifyPayment(clubId: string, paymentId: string): Promise<Payment> {
	return api.post<Payment>(`/clubs/${clubId}/payments/${paymentId}/verify`);
}

export function rejectPayment(clubId: string, paymentId: string, note?: string): Promise<Payment> {
	return api.post<Payment>(`/clubs/${clubId}/payments/${paymentId}/reject`, { note });
}

export type MarkPaidResult = { id: string; ok: boolean; error?: string };

export function markBillsPaid(clubId: string, itemIds: string[]): Promise<{ results: MarkPaidResult[] }> {
	return api.post<{ results: MarkPaidResult[] }>(`/clubs/${clubId}/bills/mark-paid`, { item_ids: itemIds });
}
