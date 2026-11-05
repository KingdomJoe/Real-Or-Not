/*
 * RON (Real or Not) — Check B: Story & Web Context (server-only).
 *
 * Proxies Meta Model API (Muse Spark 1.3 + web_search grounding) so the
 * META_API_KEY never reaches the browser. Returns verifiable source URLs
 * or an honest no-copies result — never invented links.
 */

import { META_API_KEY } from '$app/env/private';
import {
	buildLimcPrompt,
	cleanTitle,
	isAllowedSourceUrl,
	parseLimcBriefing,
	type LimcSource
} from '#lib/server/limc';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const META_BASE = 'https://api.meta.ai/v1';

type WebSource = LimcSource;

export const POST: RequestHandler = async ({ request }) => {
	if (!META_API_KEY) {
		return json({
			status: 'unconfigured',
			message: 'META_API_KEY is not set on the server.'
		});
	}
	let body: { query?: string; title?: string; platform?: string };
	try {
		body = await request.json();
	} catch {
		return json({ status: 'error', message: 'Invalid JSON body.' }, { status: 400 });
	}
	const subject = (body.query || body.title || '').trim().slice(0, 500);
	if (!subject) {
		return json({ status: 'error', message: 'Missing query.' }, { status: 400 });
	}
	const platformHint = body.platform ? ` (seen on ${body.platform})` : '';
	const input = buildLimcPrompt(subject, platformHint);

	try {
		const res = await fetch(`${META_BASE}/responses`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${META_API_KEY}`,
				'Content-Type': 'application/json'
			},
		body: JSON.stringify({
			model: 'muse-spark-1.3',
			input,
			tools: [{ type: 'web_search', search_context_size: 'medium' }],
			include: ['web_search_call.results'],
			max_output_tokens: 900
		}),
			signal: AbortSignal.timeout(90000)
		});
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			return json({
				status: 'error',
				message: `Meta API responded ${res.status}: ${text.slice(0, 300)}`
			});
		}
		const data = await res.json();
		const sources: WebSource[] = [];
		const seen = new Set<string>();
		let searched = false;
		let summary = '';
		const output: unknown[] = Array.isArray(data?.output) ? data.output : [];
		for (const item of output) {
			const entry = item as {
				type?: string;
				results?: Array<{ title?: string; url?: string; snippet?: string }>;
				content?: Array<{
					type?: string;
					text?: string;
					annotations?: Array<{ type?: string; title?: string; url?: string }>;
				}>;
			};
			if (entry?.type === 'web_search_call') {
				searched = true;
				for (const r of entry.results ?? []) {
					if (r?.url && !seen.has(r.url) && isAllowedSourceUrl(r.url)) {
						seen.add(r.url);
						sources.push({ title: cleanTitle(r.title, r.url), url: r.url, snippet: r.snippet ?? '' });
					}
				}
			}
			if (entry?.type === 'message') {
				for (const block of entry.content ?? []) {
					if (block?.type === 'output_text') {
						summary += block.text ?? '';
						for (const ann of block.annotations ?? []) {
							if (ann?.type === 'url_citation' && ann.url && !seen.has(ann.url) && isAllowedSourceUrl(ann.url)) {
								seen.add(ann.url);
								sources.push({ title: cleanTitle(ann.title, ann.url), url: ann.url, snippet: '' });
							}
						}
					}
				}
			}
		}
		return json({
			status: 'ok',
			searched,
			summary: summary.slice(0, 2000),
			briefing: parseLimcBriefing(summary),
			sources: sources.slice(0, 8),
			model: typeof data?.model === 'string' ? data.model : 'muse-spark-1.3'
		});
	} catch (err) {
		return json({
			status: 'error',
			message: err instanceof Error ? err.message : 'Web check failed.'
		});
	}
};
