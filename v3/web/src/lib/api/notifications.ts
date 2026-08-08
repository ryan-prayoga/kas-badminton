// Klien pusat notifikasi in-app + preferensi + langganan Web Push
// (API.md §6, PLAN.md §10, F8). Lintas klub — bukan /clubs/{clubId}/....
import { api } from './client';

export type AppNotification = {
	id: string;
	club_id?: string;
	kind: string;
	channel: 'push' | 'wa' | 'inapp';
	title?: string;
	body?: string;
	url?: string;
	status: 'queued' | 'sent' | 'failed' | 'skipped';
	read_at?: string;
	created_at: string;
};

export function listNotifications(unreadOnly = false): Promise<AppNotification[]> {
	return api
		.get<{ items: AppNotification[] }>('/me/notifications', unreadOnly ? { unread: 'true' } : undefined)
		.then((r) => r.items);
}

export function markNotificationRead(id: string): Promise<AppNotification> {
	return api.post(`/me/notifications/${id}/read`);
}

export type NotificationPref = { club_id?: string; kind: string; push_on: boolean; wa_on: boolean };

export function getNotificationPrefs(): Promise<NotificationPref[]> {
	return api.get<{ items: NotificationPref[] }>('/me/notification-prefs').then((r) => r.items);
}

export function patchNotificationPref(pref: NotificationPref): Promise<NotificationPref> {
	return api.patch('/me/notification-prefs', pref);
}

export function getVapidPublicKey(): Promise<string> {
	return api.get<{ public_key: string }>('/me/push-vapid-key').then((r) => r.public_key);
}

export function createPushSubscription(sub: PushSubscriptionJSON): Promise<{ id: string; endpoint: string }> {
	return api.post('/me/push-subscriptions', sub);
}

export function deletePushSubscription(id: string): Promise<void> {
	return api.del(`/me/push-subscriptions/${id}`);
}
