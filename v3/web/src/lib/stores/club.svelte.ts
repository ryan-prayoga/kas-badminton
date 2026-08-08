// Klub aktif (PLAN.md §5.5.1 "ikut lebih dari satu klub" — berpindah klub
// harus jelas terasa berpindah konteks). Sumber kebenaran GET /me
// (memberships[]), di-refresh tiap loadMe() — localStorage cuma nyimpen
// PILIHAN klub aktif terakhir buat default berikutnya, bukan cache data
// klub itu sendiri.
import { fetchMe, type MeMembership } from '$lib/api/me';

const ACTIVE_CLUB_KEY = 'kok-active-club-id';

let memberships = $state<MeMembership[]>([]);
let activeClubId = $state<string | null>(readStoredActiveClubId());
let loaded = $state(false);
let loading = $state(false);

function readStoredActiveClubId(): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(ACTIVE_CLUB_KEY);
}

export function myMemberships(): MeMembership[] {
	return memberships;
}

export function activeClub(): MeMembership | null {
	return memberships.find((m) => m.club_id === activeClubId) ?? memberships[0] ?? null;
}

export function otherMemberships(): MeMembership[] {
	const current = activeClub();
	return memberships.filter((m) => m.club_id !== current?.club_id);
}

// hasManageMoney — cermin ringan perm.ManageMoney (server/internal/perm,
// §7.4) buat GATING TAMPILAN saja ("pintu masuk Tagihan & Kas", §5.4).
// Server tetap sumber kebenaran (RequirePerm di tiap endpoint) — helper
// ini cuma mencegah UI menawarkan tombol yang bakal ditolak 403.
export function hasManageMoney(m: MeMembership | null): boolean {
	if (!m) return false;
	if (m.role !== 'admin' && m.role !== 'bendahara') return false;
	if (m.role_expires_at && new Date(m.role_expires_at) <= new Date()) return false;
	return true;
}

export function hasLoadedMemberships(): boolean {
	return loaded;
}
export function isLoadingMemberships(): boolean {
	return loading;
}

export function setActiveClub(clubId: string) {
	activeClubId = clubId;
	if (typeof localStorage !== 'undefined') localStorage.setItem(ACTIVE_CLUB_KEY, clubId);
}

// dipanggil root layout saat boot (login) dan sesudah bikin/gabung klub
// baru — satu-satunya jalan tahu "klub apa saja aku ikuti" (migrasi 00021).
export async function loadMe(): Promise<void> {
	loading = true;
	try {
		const me = await fetchMe();
		memberships = me.memberships;
		if (!memberships.some((m) => m.club_id === activeClubId)) {
			const fallback = memberships[0]?.club_id ?? null;
			activeClubId = fallback;
			if (typeof localStorage !== 'undefined') {
				if (fallback) localStorage.setItem(ACTIVE_CLUB_KEY, fallback);
				else localStorage.removeItem(ACTIVE_CLUB_KEY);
			}
		}
	} finally {
		loading = false;
		loaded = true;
	}
}
