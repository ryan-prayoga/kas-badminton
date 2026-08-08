// Klien tipis treasury + expenses (API.md §4 "Kas & QRIS", F6/3) — dipakai
// klub/kas (F6/6, bendahara).
import { api } from './client';

export type Treasury = {
	kas_klub: number;
	titipan_pemain: number;
	iuran_turnamen: number;
};

export function fetchTreasury(clubId: string): Promise<Treasury> {
	return api.get<Treasury>(`/clubs/${clubId}/treasury`);
}

export type Expense = {
	id: string;
	amount: number;
	type_name?: string;
	slops: number;
	note?: string;
	created_at: string;
};

export function listExpenses(clubId: string): Promise<{ items: Expense[] }> {
	return api.get<{ items: Expense[] }>(`/clubs/${clubId}/expenses`);
}

// createExpense ONLINE-ONLY — pengeluaran kas nyata, bendahara harus tahu
// seketika kalau gagal tersimpan (sama alasan topup/withdraw, wallet.ts).
export function createExpense(
	clubId: string,
	input: { amount: number; type_name?: string; slops?: number; note?: string }
): Promise<Expense> {
	return api.post<Expense>(`/clubs/${clubId}/expenses`, input);
}
