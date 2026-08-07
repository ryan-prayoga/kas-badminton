// Jembatan navigator.credentials.* <-> API passkey (internal/http/auth_passkey.go,
// PLAN.md §7.2). Server bicara base64url STRING (protocol.URLEncodedBase64
// di Go selalu marshal begitu); WebAuthn browser API bicara ArrayBuffer —
// semua konversi ada di sini, satu tempat, supaya routes/* tidak perlu
// tahu detail encoding-nya.
import { api } from './client';
import { setSession, type SessionUser } from '$lib/stores/session.svelte';

function b64urlToBuf(s: string): ArrayBuffer {
	const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
	const base64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(base64);
	const buf = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
	return buf.buffer;
}

function bufToB64url(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// isPasskeySupported — PWA standalone di iOS versi lama riwayatnya
// berubah-ubah (PLAN.md §7.2) — selalu cek, jangan asumsikan tersedia.
// Passkey dan PIN SETARA (bukan utama-cadangan), jadi kegagalan di sini
// harus jatuh balik ke PIN dengan tenang, bukan dianggap galat fatal.
export function isPasskeySupported(): boolean {
	return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

type CreationOptionsResponse = {
	publicKey: PublicKeyCredentialCreationOptionsJSON;
	session_id: string;
};
type AssertionOptionsResponse = {
	publicKey: PublicKeyCredentialRequestOptionsJSON;
	session_id: string;
};
type PublicKeyCredentialCreationOptionsJSON = Omit<
	PublicKeyCredentialCreationOptions,
	'challenge' | 'user' | 'excludeCredentials'
> & {
	challenge: string;
	user: { id: string; name: string; displayName: string };
	excludeCredentials?: { id: string; type: string; transports?: string[] }[];
};
type PublicKeyCredentialRequestOptionsJSON = Omit<
	PublicKeyCredentialRequestOptions,
	'challenge' | 'allowCredentials'
> & {
	challenge: string;
	rpId?: string;
	allowCredentials?: { id: string; type: string; transports?: string[] }[];
};

type AuthResult = { session_token: string; user: SessionUser };

// registerPasskey — RequireAuth (dipanggil sesudah OTP verify, §7.2:
// "keduanya didaftarkan saat klaim akun").
export async function registerPasskey(): Promise<void> {
	const opts = await api.post<CreationOptionsResponse>('/auth/passkey/register/options');

	const publicKey: PublicKeyCredentialCreationOptions = {
		...opts.publicKey,
		challenge: b64urlToBuf(opts.publicKey.challenge),
		user: {
			...opts.publicKey.user,
			id: b64urlToBuf(opts.publicKey.user.id)
		},
		excludeCredentials: (opts.publicKey.excludeCredentials ?? []).map((c) => ({
			...c,
			id: b64urlToBuf(c.id),
			type: 'public-key' as const,
			transports: c.transports as AuthenticatorTransport[] | undefined
		}))
	};

	const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential;
	if (!cred) throw new Error('Pendaftaran passkey dibatalkan.');
	const response = cred.response as AuthenticatorAttestationResponse;

	await api.post(
		'/auth/passkey/register/verify',
		{
			id: cred.id,
			rawId: bufToB64url(cred.rawId),
			type: cred.type,
			response: {
				clientDataJSON: bufToB64url(response.clientDataJSON),
				attestationObject: bufToB64url(response.attestationObject)
			}
		},
		{ session_id: opts.session_id }
	);
}

// loginWithPasskey — discoverable/usernameless (§7.2 "buka berikutnya...
// cukup Face ID"): browser menawarkan pilihan sendiri, tidak perlu nomor
// dulu.
export async function loginWithPasskey(): Promise<AuthResult> {
	const opts = await api.post<AssertionOptionsResponse>('/auth/passkey/login/options');

	const publicKey: PublicKeyCredentialRequestOptions = {
		...opts.publicKey,
		challenge: b64urlToBuf(opts.publicKey.challenge),
		allowCredentials: (opts.publicKey.allowCredentials ?? []).map((c) => ({
			...c,
			id: b64urlToBuf(c.id),
			type: 'public-key' as const,
			transports: c.transports as AuthenticatorTransport[] | undefined
		}))
	};

	const cred = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential;
	if (!cred) throw new Error('Login passkey dibatalkan.');
	const response = cred.response as AuthenticatorAssertionResponse;

	const result = await api.post<AuthResult>(
		'/auth/passkey/login/verify',
		{
			id: cred.id,
			rawId: bufToB64url(cred.rawId),
			type: cred.type,
			response: {
				clientDataJSON: bufToB64url(response.clientDataJSON),
				authenticatorData: bufToB64url(response.authenticatorData),
				signature: bufToB64url(response.signature),
				userHandle: response.userHandle ? bufToB64url(response.userHandle) : undefined
			}
		},
		{ session_id: opts.session_id }
	);
	setSession(result.session_token, result.user);
	return result;
}
