/*
 * RON (Real or Not) — unified live analysis (server-only).
 *
 * Orchestrates every heavy model for one captured/uploaded media item:
 * SigLIP-2 + AudioSeal (Modal GPU), Muse Voice Transcribe + Muse Spark 1.3
 * web grounding (Meta Model API), and Muse Spark Open synthesis. Each stage
 * fails honestly and independently — `modelsExecuted` lists ONLY what ran.
 */

import {
	META_API_KEY,
	MODAL_ENDPOINT_URL,
	MODAL_WEBHOOK_SECRET,
	OPENROUTER_OR_MODAL_SPARK_OPEN_KEY,
	SPARK_OPEN_BASE_URL
} from '$app/env/private';
import { buildLimcPrompt, cleanTitle, isAllowedSourceUrl, parseLimcBriefing } from '#lib/server/limc';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const META_BASE = 'https://api.meta.ai/v1';
const SPARK_MODEL_ID = 'meta-models/Muse-Spark-Open-816B-A42B';
const MAX_B64 = 12_000_000;

type VerdictKey = 'real' | 'filtered' | 'partial_ai' | 'twisted_story' | 'made_by_ai' | 'too_blurry';

interface AnalyzeBody {
	fileName?: string;
	tabLabel?: string;
	platform?: string;
	kind?: string;
	frames?: string[];
	wavBase64?: string;
	provenance?: {
		hasC2paManifest?: boolean;
		c2paSignerOrGenerator?: string | null;
		iptcDigitalSourceType?: string | null;
		detectedAiGeneratorString?: string | null;
		sha256Hash?: string;
		fileSizeMB?: number;
		isHeavilyCompressed?: boolean;
	};
	regional?: {
		overallAnomalyScore?: number;
		regionScores?: Array<{
			maskId?: string;
			label?: string;
			meanElaInside?: number;
			meanElaOutside?: number;
			elaDivergenceSigma?: number;
			highFreqEnergyRatio?: number;
			isFlaggedAnomaly?: boolean;
			ablationScoreIfHidden?: number;
		}>;
	};
}

interface StageError {
	stage: string;
	message: string;
}

function asRecord(v: unknown): Record<string, unknown> {
	return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
}

export const POST: RequestHandler = async ({ request }) => {
	let body: AnalyzeBody;
	try {
		body = (await request.json()) as AnalyzeBody;
	} catch {
		return json({ status: 'error', message: 'Invalid JSON body.' }, { status: 400 });
	}
	const subject = (body.tabLabel || body.fileName || 'captured media').slice(0, 300);
	const errors: StageError[] = [];
	const modelsExecuted: string[] = [];

	/* ── Stage 1: SigLIP-2 deepfake score on the first frame (Modal) ─────── */
	const siglipPromise: Promise<number | null> = (async () => {
		const frame = body.frames?.[0];
		if (!frame || !MODAL_ENDPOINT_URL) return null;
		try {
			const res = await fetch(MODAL_ENDPOINT_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'ron_analyze_frame',
					client_ip: 'ron-analyze',
					webhook_secret: MODAL_WEBHOOK_SECRET,
					image_base64: frame
				}),
				signal: AbortSignal.timeout(120000)
			});
			const data = asRecord(await res.json().catch(() => ({})));
			if (data.status === 'ok' && typeof data.siglip2_fake_probability === 'number') {
				modelsExecuted.push('SigLIP-2 (Modal)');
				return data.siglip2_fake_probability as number;
			}
			errors.push({
				stage: 'siglip',
				message: typeof data.plain_message === 'string' ? data.plain_message : 'No score returned.'
			});
			return null;
		} catch (err) {
			errors.push({ stage: 'siglip', message: err instanceof Error ? err.message : 'SigLIP failed.' });
			return null;
		}
	})();

	/* ── Stage 2: AudioSeal per-second slices (Modal) ─────────────────────── */
	const sealPromise: Promise<Array<{ startSec: number; endSec: number; syntheticWatermarkProb: number; isFlagged: boolean }> | null> =
		(async () => {
			if (!body.wavBase64 || !MODAL_ENDPOINT_URL) return null;
			try {
				const res = await fetch(MODAL_ENDPOINT_URL, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						mode: 'ron_analyze_audio',
						client_ip: 'ron-analyze',
						webhook_secret: MODAL_WEBHOOK_SECRET,
						audio_wav_base64: body.wavBase64
					}),
					signal: AbortSignal.timeout(120000)
				});
				const data = asRecord(await res.json().catch(() => ({})));
				if (Array.isArray(data.audioseal_slices)) {
					modelsExecuted.push('AudioSeal (Modal)');
					return (data.audioseal_slices as Array<Record<string, unknown>>).map((s, i) => ({
						startSec: typeof s.startSec === 'number' ? s.startSec : i,
						endSec: typeof s.endSec === 'number' ? s.endSec : i + 1,
						syntheticWatermarkProb:
							typeof s.syntheticWatermarkProb === 'number' ? s.syntheticWatermarkProb : 0,
						isFlagged: s.isFlagged === true
					}));
				}
				errors.push({
					stage: 'audioseal',
					message:
						typeof data.plain_message === 'string' ? data.plain_message : 'No slices returned.'
				});
				return null;
			} catch (err) {
				errors.push({ stage: 'audioseal', message: err instanceof Error ? err.message : 'AudioSeal failed.' });
				return null;
			}
		})();

	/* ── Stage 3: Muse Voice Transcribe with diarization (Meta) ───────────── */
	const transcribePromise: Promise<{ transcript: string; turns: Array<{ turnId: number; startMs: number; endMs: number; transcript: string; speaker: string | null }> } | null> =
		(async () => {
			if (!body.wavBase64 || !META_API_KEY) return null;
			if (body.wavBase64.length > MAX_B64) {
				errors.push({ stage: 'transcribe', message: 'Audio too large for transcription.' });
				return null;
			}
			try {
				const form = new FormData();
				form.append(
					'request',
					new Blob(
						[
							JSON.stringify({
								mode: 'DIARIZATION',
								model: 'muse-voice-transcribe-1.0',
								audioEncoding: 'WAV'
							})
						],
						{ type: 'application/json' }
					)
				);
				form.append(
					'audio',
					new File([Buffer.from(body.wavBase64, 'base64')], 'ron-analyze.wav', { type: 'audio/wav' })
				);
				const res = await fetch(
					`https://api.meta.ai/v1/asr/transcribe?sessionId=${encodeURIComponent(`ron-analyze-${Date.now()}`)}`,
					{
						method: 'POST',
						headers: { Authorization: `Bearer ${META_API_KEY}` },
						body: form,
						signal: AbortSignal.timeout(120000)
					}
				);
				if (!res.ok) {
					errors.push({ stage: 'transcribe', message: `Transcribe API ${res.status}.` });
					return null;
				}
				const data = asRecord(await res.json());
				modelsExecuted.push('Muse Voice Transcribe 1.0');
				const turns = Array.isArray(data.turns)
					? (data.turns as Array<Record<string, unknown>>).map((t, i) => ({
							turnId: typeof t.turnId === 'number' ? t.turnId : i + 1,
							startMs: typeof t.startMs === 'number' ? t.startMs : 0,
							endMs: typeof t.endMs === 'number' ? t.endMs : 0,
							transcript: typeof t.transcript === 'string' ? t.transcript : '',
							speaker: typeof t.speaker === 'string' ? t.speaker : null
						}))
					: [];
				return {
					transcript: typeof data.transcript === 'string' ? data.transcript : '',
					turns
				};
			} catch (err) {
				errors.push({ stage: 'transcribe', message: err instanceof Error ? err.message : 'Transcription failed.' });
				return null;
			}
		})();

	/* ── Stage 4: LIMC web briefing (Meta Spark + web_search) ─────────────── */
	const webPromise: Promise<{
		briefing: { origin: string; evolution: string; impact: string };
		sources: Array<{ title: string; url: string; snippet: string }>;
	} | null> = (async () => {
		if (!META_API_KEY) return null;
		try {
			const platformHint = body.platform ? ` (seen on ${body.platform})` : '';
			const res = await fetch(`${META_BASE}/responses`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${META_API_KEY}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'muse-spark-1.3',
					input: buildLimcPrompt(subject, platformHint),
					tools: [{ type: 'web_search', search_context_size: 'medium' }],
					include: ['web_search_call.results'],
					max_output_tokens: 900
				}),
				signal: AbortSignal.timeout(90000)
			});
			if (!res.ok) {
				errors.push({ stage: 'web', message: `Meta API ${res.status}.` });
				return null;
			}
			const data = asRecord(await res.json());
			const sources: Array<{ title: string; url: string; snippet: string }> = [];
			const seen = new Set<string>();
			let summary = '';
			const output: unknown[] = Array.isArray(data.output) ? data.output : [];
			for (const item of output) {
				const entry = asRecord(item);
				if (entry.type === 'web_search_call' && Array.isArray(entry.results)) {
					for (const r of entry.results as Array<Record<string, unknown>>) {
						const url = typeof r.url === 'string' ? r.url : '';
						if (url && !seen.has(url) && isAllowedSourceUrl(url)) {
							seen.add(url);
							sources.push({
								title: cleanTitle(r.title, url),
								url,
								snippet: typeof r.snippet === 'string' ? r.snippet : ''
							});
						}
					}
				}
				if (entry.type === 'message' && Array.isArray(entry.content)) {
					for (const block of entry.content as Array<Record<string, unknown>>) {
						if (block.type === 'output_text') {
							summary += typeof block.text === 'string' ? block.text : '';
							const anns = Array.isArray(block.annotations) ? block.annotations : [];
							for (const a of anns as Array<Record<string, unknown>>) {
								const url = typeof a.url === 'string' ? a.url : '';
								if (a.type === 'url_citation' && url && !seen.has(url) && isAllowedSourceUrl(url)) {
									seen.add(url);
									sources.push({ title: cleanTitle(a.title, url), url, snippet: '' });
								}
							}
						}
					}
				}
			}
			modelsExecuted.push('Muse Spark 1.3 + web_search');
			return { briefing: parseLimcBriefing(summary), sources: sources.slice(0, 8) };
		} catch (err) {
			errors.push({ stage: 'web', message: err instanceof Error ? err.message : 'Web check failed.' });
			return null;
		}
	})();

	const [siglipFakeProb, sealSlices, transcription, web] = await Promise.all([
		siglipPromise,
		sealPromise,
		transcribePromise,
		webPromise
	]);

	/* ── Stage 5: Spark Open narrative synthesis over the real evidence ───── */
	let narrative: {
		plainHeadline: string;
		whatsReal: string;
		whatsChanged: string;
		safetyAction: string;
		verdict: VerdictKey;
		confidencePercent: number;
	} | null = null;
	const evidence = {
		subject,
		kind: body.kind ?? 'unknown',
		provenance: body.provenance ?? null,
		regional: body.regional ?? null,
		siglipFakeProb,
		sealSlices,
		transcript: transcription?.transcript?.slice(0, 1200) ?? null,
		turns: transcription?.turns ?? [],
		webBriefing: web?.briefing ?? null,
		webSources: (web?.sources ?? []).map((s) => ({ title: s.title, url: s.url }))
	};
	if (OPENROUTER_OR_MODAL_SPARK_OPEN_KEY && SPARK_OPEN_BASE_URL) {
		try {
			const res = await fetch(`${SPARK_OPEN_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${OPENROUTER_OR_MODAL_SPARK_OPEN_KEY}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					model: 'meta-models/Muse-Spark-Open-816B-A42B',
					messages: [
						{
							role: 'system',
							content:
								'You are RON, a friendly media-trust analyst. Reply with ONE compact JSON object only, no markdown fences, no extra text. Shape: {"plainHeadline": string (1 sentence, plain English), "whatsReal": string, "whatsChanged": string, "safetyAction": string (practical advice tailored to THIS media), "verdict": one of real|filtered|partial_ai|twisted_story|made_by_ai|too_blurry, "confidencePercent": number 5-99}. Never invent measurements — only interpret the evidence given. If evidence is thin, choose too_blurry and say what is missing.'
						},
						{ role: 'user', content: `Evidence (JSON, measured live):\n${JSON.stringify(evidence).slice(0, 6000)}` }
					],
					max_tokens: 700,
					temperature: 0.2,
					reasoning_effort: 'low'
				}),
				signal: AbortSignal.timeout(180000)
			});
			if (res.ok) {
				const data = asRecord(await res.json());
				const choice = asRecord(
					(Array.isArray(data.choices) ? data.choices[0] : {}) as unknown
				);
				const message = asRecord(choice.message);
				const raw = typeof message.content === 'string' ? message.content : '';
				const cleaned = raw
					.replace(/```json\s*/i, '')
					.replace(/```\s*/g, '')
					.trim();
				const start = cleaned.indexOf('{');
				const end = cleaned.lastIndexOf('}');
				if (start >= 0 && end > start) {
					const parsed = asRecord(JSON.parse(cleaned.slice(start, end + 1)));
					const verdicts: VerdictKey[] = [
						'real',
						'filtered',
						'partial_ai',
						'twisted_story',
						'made_by_ai',
						'too_blurry'
					];
					const verdict: VerdictKey = verdicts.includes(parsed.verdict as VerdictKey)
						? (parsed.verdict as VerdictKey)
						: 'too_blurry';
					const conf =
						typeof parsed.confidencePercent === 'number'
							? Math.min(99, Math.max(5, Math.round(parsed.confidencePercent)))
							: 50;
					if (
						typeof parsed.plainHeadline === 'string' &&
						typeof parsed.whatsReal === 'string' &&
						typeof parsed.whatsChanged === 'string' &&
						typeof parsed.safetyAction === 'string'
					) {
						narrative = {
							plainHeadline: parsed.plainHeadline.slice(0, 300),
							whatsReal: parsed.whatsReal.slice(0, 600),
							whatsChanged: parsed.whatsChanged.slice(0, 600),
							safetyAction: parsed.safetyAction.slice(0, 600),
							verdict,
							confidencePercent: conf
						};
						modelsExecuted.push('Muse Spark Open (narrative)');
					} else {
						errors.push({ stage: 'narrative', message: 'Model reply was not valid JSON.' });
					}
				} else {
					errors.push({ stage: 'narrative', message: 'Model reply contained no JSON object.' });
				}
			} else {
				errors.push({ stage: 'narrative', message: `Spark Open ${res.status}.` });
			}
		} catch (err) {
			errors.push({ stage: 'narrative', message: err instanceof Error ? err.message : 'Synthesis failed.' });
		}
	}

	return json({
		status: 'ok',
		modelsExecuted,
		errors,
		siglipFakeProb,
		sealSlices,
		transcript: transcription?.transcript ?? '',
		turns: transcription?.turns ?? [],
		briefing: web?.briefing ?? { origin: '', evolution: '', impact: '' },
		sources: web?.sources ?? [],
		narrative
	});
};
