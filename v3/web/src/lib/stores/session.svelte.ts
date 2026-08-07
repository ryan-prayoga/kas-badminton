// Sesi login (PLAN.md §7.2) — token Bearer + profil ringkas, disimpan di
// localStorage supaya "buka app besok, masih login" (§7.2 "sesi hidup >
// 90 hari"). Bukan cache lengkap /me — cuma yang dibutuhkan tampilan
// header (nama, id) sebelum data sungguhan datang.
export type SessionUser = {
	id: string;
	phone: string;
	display_name: string;
};

const TOKEN_KEY = 'kok-session-token';
const USER_KEY = 'kok-session-user';

let token = $state<string | null>(readStorage(TOKEN_KEY));
let user = $state<SessionUser | null>(readJSON<SessionUser>(USER_KEY));

function readStorage(key: string): string | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage.getItem(key);
}
function readJSON<T>(key: string): T | null {
	const raw = readStorage(key);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

export function getToken(): string | null {
	return token;
}
export function currentUser(): SessionUser | null {
	return user;
}
export function isLoggedIn(): boolean {
	return token !== null;
}

export function setSession(newToken: string, newUser: SessionUser) {
	token = newToken;
	user = newUser;
	localStorage.setItem(TOKEN_KEY, newToken);
	localStorage.setItem(USER_KEY, JSON.stringify(newUser));
}

// clearSession — TIDAK memanggil POST /auth/logout sendiri (itu tanggung
// jawab pemanggil, butuh await sebelum sesi lokal dibuang — lihat
// routes/account/sessions/+page.svelte).
export function clearSession() {
	token = null;
	user = null;
	localStorage.removeItem(TOKEN_KEY);
	localStorage.removeItem(USER_KEY);
}
