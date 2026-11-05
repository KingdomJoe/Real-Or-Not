/*
 * RON (Real or Not) — backend health probe (server-only).
 *
 * Reports CONFIGURATION PRESENCE ONLY — never key values. The UI uses this to
 * show an honest "Live backend / Degraded / Offline demo" pill instead of
 * silently falling back and feeling generic.
 */

import {
	META_API_KEY,
	MODAL_ENDPOINT_URL,
	OPENROUTER_OR_MODAL_SPARK_OPEN_KEY,
	SPARK_OPEN_BASE_URL,
	MODAL_WEBHOOK_SECRET
} from '$app/env/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const modal = MODAL_ENDPOINT_URL.trim().length > 0;
	let modalReachable: boolean | null = null;
	if (modal) {
		try {
			const ctrl = new AbortController();
			// Generous timeout: a cold Modal container can take 15s+ to answer.
			const timer = setTimeout(() => ctrl.abort(), 25000);
			// POST-only endpoint: ANY HTTP answer (even 404/405) proves it is alive.
			const res = await fetch(MODAL_ENDPOINT_URL, { method: 'GET', signal: ctrl.signal });
			clearTimeout(timer);
			modalReachable = res.status < 500;
		} catch {
			modalReachable = false;
		}
	}
	return json({
		status: 'ok',
		meta: META_API_KEY.trim().length > 0,
		modal,
		modalReachable,
		webhook: MODAL_WEBHOOK_SECRET.trim().length > 0,
		sparkOpen:
			OPENROUTER_OR_MODAL_SPARK_OPEN_KEY.trim().length > 0 &&
			SPARK_OPEN_BASE_URL.trim().length > 0
	});
};
