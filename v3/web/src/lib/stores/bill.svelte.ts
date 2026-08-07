// Tagihanku (PLAN.md §5.5 hero Beranda) — $state buat klub aktif,
// di-refresh dari GET .../me/bill. Baca doang di F5/3 ("Bayar sekarang"
// beneran nunggu F6 QRIS/payments-claim); patchTotal dipakai handler SSE
// bill.updated nanti biar angka nambal sendiri tanpa refetch (API.md §8).
import { fetchMyBill, type MyBill } from '$lib/api/me';

let bill = $state<MyBill | null>(null);
let loading = $state(false);
let loadedForClub = $state<string | null>(null);

export function myBill(): MyBill | null {
	return bill;
}
export function isBillLoading(): boolean {
	return loading;
}
export function billLoadedForClub(): string | null {
	return loadedForClub;
}

export async function loadMyBill(clubId: string): Promise<void> {
	loading = true;
	try {
		bill = await fetchMyBill(clubId);
		loadedForClub = clubId;
	} finally {
		loading = false;
	}
}

export function patchTotal(clubId: string, totalOwed: number) {
	if (loadedForClub !== clubId || !bill) return;
	bill = { ...bill, total_owed: totalOwed };
}
