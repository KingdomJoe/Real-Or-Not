/*
 * RON (Real or Not) — typed browser client for the server AI routes.
 * All provider keys stay server-side; the browser only ever sees results.
 */

import { browser } from '$app/env';
import { PUBLIC_MODAL_ENDPOINT, PUBLIC_MODAL_WEBHOOK_SECRET } from '$app/env/public';

export interface WebSource {
	title: string;
	url: string;
	snippet: string;
}

export interface LimcBriefing {
	origin: string;
	evolution: string;
	impact: string;
}

export type WebContextResult =
	| {
			status: 'ok';
			searched: boolean;
			summary: string;
			briefing: LimcBriefing;
			sources: WebSource[];
			model: string;
	  }
	| { status: 'unconfigured' | 'error'; message: string };

export interface TranscriptTurn {
	turnId: number;
	startMs: number;
	endMs: number;
	transcript: string;
	speaker: string | null;
}

export type TranscribeResult =
	| { status: 'ok'; transcript: string; durationMs: number; turns: TranscriptTurn[] }
	| { status: 'unconfigured' | 'error'; message: string };

export type SparkOpenResult =
	| { status: 'ok'; text: string; reasoning: string | null; model: string }
	| { status: 'unconfigured' | 'error'; message: string };

async function postJson<T>(path: string, payload: Record<string, unknown>): Promise<T> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	return (await res.json()) as T;
}

/** Check B: live web-context lookup via Muse Spark + search grounding. */
export async function checkWebContext(
	query: string,
	opts: { title?: string; platform?: string } = {}
): Promise<WebContextResult> {
	if (!browser) return { status: 'error', message: 'Browser only.' };
	try {
		return await postJson<WebContextResult>('/api/web-context', {
			query,
			title: opts.title ?? '',
			platform: opts.platform ?? ''
		});
	} catch (err) {
		return { status: 'error', message: err instanceof Error ? err.message : 'Web check failed.' };
	}
}

/** Voice path: transcribe 16kHz mono WAV (base64) with diarized turns. */
export async function transcribeWav(
	wavBase64: string,
	fileName = 'ron-check.wav'
): Promise<TranscribeResult> {
	if (!browser) return { status: 'error', message: 'Browser only.' };
	try {
		return await postJson<TranscribeResult>('/api/transcribe', { wavBase64, fileName });
	} catch (err) {
		return { status: 'error', message: err instanceof Error ? err.message : 'Transcription failed.' };
	}
}

export type SealResult =
	| { status: 'ok'; flaggedSeconds: number; totalSeconds: number }
	| { status: 'skipped' | 'error'; message: string };

export interface AudioWindowResult {
	seal: SealResult;
	transcript: TranscribeResult;
}

/**
 * One 3.5s window, both ears: AudioSeal watermark slices (Modal, direct) +
 * diarized transcript (Meta, via server route). Each half fails honestly and
 * independently — a transcription outage never fakes an AudioSeal verdict.
 */
export async function analyzeAudioWindow(wavBase64: string): Promise<AudioWindowResult> {
	const sealPromise: Promise<SealResult> = (async () => {
		if (!browser) return { status: 'error', message: 'Browser only.' };
		if (!PUBLIC_MODAL_ENDPOINT) {
			return {
				status: 'skipped',
				message: 'Modal backend not configured (set PUBLIC_MODAL_ENDPOINT).'
			};
		}
		try {
			const res = await fetch(PUBLIC_MODAL_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					mode: 'audio_check',
					client_ip: 'ron-buddy',
					webhook_secret: PUBLIC_MODAL_WEBHOOK_SECRET,
					audio_wav_base64: wavBase64
				})
			});
			const data = (await res.json()) as {
				status?: string;
				audioseal_slices?: Array<{ isFlagged?: boolean }>;
				plain_message?: string;
			};
			if (data.status === 'rate_limited' || data.status === 'unauthorized') {
				return { status: 'error', message: data.plain_message ?? data.status };
			}
			if (!Array.isArray(data.audioseal_slices)) {
				return { status: 'error', message: 'Backend sent no slices — inconclusive.' };
			}
			return {
				status: 'ok',
				flaggedSeconds: data.audioseal_slices.filter((s) => s.isFlagged).length,
				totalSeconds: data.audioseal_slices.length
			};
		} catch (err) {
			return {
				status: 'error',
				message: err instanceof Error ? err.message : 'AudioSeal request failed.'
			};
		}
	})();
	const [seal, transcript] = await Promise.all([sealPromise, transcribeWav(wavBase64)]);
	return { seal, transcript };
}

export interface AnalyzeTurn {
	turnId: number;
	startMs: number;
	endMs: number;
	transcript: string;
	speaker: string | null;
}

export interface AnalyzeSealSlice {
	startSec: number;
	endSec: number;
	syntheticWatermarkProb: number;
	isFlagged: boolean;
}

export interface AnalyzeNarrative {
	plainHeadline: string;
	whatsReal: string;
	whatsChanged: string;
	safetyAction: string;
	verdict: 'real' | 'filtered' | 'partial_ai' | 'twisted_story' | 'made_by_ai' | 'too_blurry';
	confidencePercent: number;
}

export interface AnalyzeBriefing {
	origin: string;
	evolution: string;
	impact: string;
}

export type AnalyzeResult =
	| {
			status: 'ok';
			modelsExecuted: string[];
			errors: Array<{ stage: string; message: string }>;
			siglipFakeProb: number | null;
			sealSlices: AnalyzeSealSlice[] | null;
			transcript: string;
			turns: AnalyzeTurn[];
			briefing: AnalyzeBriefing;
			sources: WebSource[];
			narrative: AnalyzeNarrative | null;
	  }
	| { status: 'error'; message: string };

export interface AnalyzeRequest {
	fileName?: string;
	tabLabel?: string;
	platform?: string;
	kind?: string;
	frames?: string[];
	wavBase64?: string;
	provenance?: Record<string, unknown> | null;
	regional?: Record<string, unknown> | null;
}

/** Unified live analysis: SigLIP + AudioSeal + transcribe + web grounding + synthesis. */
export async function analyzeMedia(req: AnalyzeRequest): Promise<AnalyzeResult> {
	if (!browser) return { status: 'error', message: 'Browser only.' };
	try {
		return await postJson<AnalyzeResult>('/api/analyze', { ...(req as Record<string, unknown>) });
	} catch (err) {
		return { status: 'error', message: err instanceof Error ? err.message : 'Analysis failed.' };
	}
}

export interface BackendHealth {
	status: 'ok';
	meta: boolean;
	modal: boolean;
	modalReachable: boolean | null;
	webhook: boolean;
	sparkOpen: boolean;
}

/** Backend health probe — config presence only, never values. Null on transport failure. */
export async function getBackendHealth(): Promise<BackendHealth | null> {
	if (!browser) return null;
	try {
		const res = await fetch('/api/health', { method: 'GET' });
		if (!res.ok) return null;
		const data = (await res.json()) as Partial<BackendHealth> & { status?: string };
		if (data?.status !== 'ok') return null;
		return {
			status: 'ok',
			meta: data.meta === true,
			modal: data.modal === true,
			modalReachable: typeof data.modalReachable === 'boolean' ? data.modalReachable : null,
			webhook: data.webhook === true,
			sparkOpen: data.sparkOpen === true
		};
	} catch {
		return null;
	}
}

/** Muse Spark Open second opinion over a forensic summary. */
export async function sparkOpenReason(
	prompt: string,
	opts: { system?: string; maxTokens?: number } = {}
): Promise<SparkOpenResult> {
	if (!browser) return { status: 'error', message: 'Browser only.' };
	try {
		return await postJson<SparkOpenResult>('/api/spark-open', {
			prompt,
			system: opts.system ?? '',
			maxTokens: opts.maxTokens ?? 600
		});
	} catch (err) {
		return { status: 'error', message: err instanceof Error ? err.message : 'Request failed.' };
	}
}
