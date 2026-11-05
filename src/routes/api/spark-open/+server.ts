/*
 * RON (Real or Not) — Muse Spark Open second opinion (server-only).
 *
 * Forwards a forensic summary to the hosted open-weight endpoint and returns
 * its plain-English assessment. Both the key and base URL stay server-side.
 */

import { OPENROUTER_OR_MODAL_SPARK_OPEN_KEY, SPARK_OPEN_BASE_URL } from '$app/env/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MODEL_ID = 'meta-models/Muse-Spark-Open-816B-A42B';

export const POST: RequestHandler = async ({ request }) => {
	if (!OPENROUTER_OR_MODAL_SPARK_OPEN_KEY || !SPARK_OPEN_BASE_URL) {
		return json({
			status: 'unconfigured',
			message: 'Spark Open endpoint is not configured on the server.'
		});
	}
	let body: { prompt?: unknown; system?: unknown; maxTokens?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ status: 'error', message: 'Invalid JSON body.' }, { status: 400 });
	}
	if (typeof body.prompt !== 'string' || body.prompt.trim().length === 0) {
		return json({ status: 'error', message: 'Missing prompt.' }, { status: 400 });
	}
	const maxTokens =
		typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens)
			? Math.min(1200, Math.max(200, Math.floor(body.maxTokens)))
			: 800;
	try {
		const res = await fetch(`${SPARK_OPEN_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${OPENROUTER_OR_MODAL_SPARK_OPEN_KEY}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model: MODEL_ID,
				messages: [
					{
						role: 'system',
						content:
							typeof body.system === 'string' && body.system.trim().length > 0
								? body.system.slice(0, 1000)
								: 'You are a media-forensics assistant. Answer in plain, friendly English, under 120 words. Start your answer immediately. Never invent measurements — only interpret the numbers you are given.'
					},
					{ role: 'user', content: body.prompt.slice(0, 4000) }
				],
				max_tokens: maxTokens,
				temperature: 0.2,
				// The 816B model thinks at length by default; low effort keeps the
				// verdict snappy without starving the answer text.
				reasoning_effort: 'low'
			}),
			signal: AbortSignal.timeout(180000)
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			return json({
				status: 'error',
				message: `Spark Open responded ${res.status}: ${text.slice(0, 300)}`
			});
		}
		const data = await res.json();
		const choice = data?.choices?.[0]?.message;
		return json({
			status: 'ok',
			text: typeof choice?.content === 'string' ? choice.content : '',
			reasoning: typeof choice?.reasoning_content === 'string' ? choice.reasoning_content : null,
			model: typeof data?.model === 'string' ? data.model : MODEL_ID
		});
	} catch (err) {
		return json({
			status: 'error',
			message: err instanceof Error ? err.message : 'Spark Open request failed.'
		});
	}
};
