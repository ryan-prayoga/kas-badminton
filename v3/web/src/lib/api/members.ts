// Klien tipis GET .../members?q= (API.md §2) — daftar + pencarian anggota,
// dipakai tab Klub (F5/4) dan nanti pemilih pemain saat catat main (F5/5).
import { api } from './client';

export type Member = {
	user_id: string;
	display_name: string;
	username?: string;
	phone?: string;
	status: 'unclaimed' | 'active' | 'disabled';
	role: string;
	role_expires_at?: string;
	is_tournament_guest: boolean;
	auto_deduct: boolean;
};

export function listMembers(clubId: string, q = ''): Promise<Member[]> {
	return api.get<Member[]>(`/clubs/${clubId}/members`, q ? { q } : undefined);
}
