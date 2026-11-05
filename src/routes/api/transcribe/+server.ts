/*
 * RON (Real or Not) — Voice path: Muse Voice Transcribe file endpoint (server-only).
 *
 * Accepts 16kHz mono 16-bit PCM WAV (base64) produced by audioWavEncoder and
 * returns the transcript plus diarized turns. META_API_KEY never leaves the server.
 */

import { META_API_KEY } from '$app/env/private';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const MAX_B64_CHARS = 12_000_000; // ~9MB WAV — well under Meta's 32MB cap

interface TurnOut {
	turnId: number;
	startMs: number;
	endMs: number;
	transcript: string;
	speaker: string | null;
}

export const POST: RequestHandler = async ({ request }) => {
	if (!META_API_KEY) {
		return json({
			status: 'unconfigured',
			message: 'META_API_KEY is not set on the server.'
		});
	}
	let body: { wavBase64?: unknown; fileName?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ status: 'error', message: 'Invalid JSON body.' }, { status: 400 });
	}
	if (typeof body.wavBase64 !== 'string' || body.wavBase64.length === 0) {
		return json({ status: 'error', message: 'Missing wavBase64 audio.' }, { status: 400 });
	}
	if (body.wavBase64.length > MAX_B64_CHARS) {
		return json(
			{ status: 'error', message: 'Audio too large — keep clips short.' },
			{ status: 413 }
		);
	}
	const wavBytes = Buffer.from(body.wavBase64, 'base64');
	const sessionId = `ron-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
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
		new File([wavBytes], typeof body.fileName === 'string' ? body.fileName : 'ron-check.wav', {
			type: 'audio/wav'
		})
	);
	try {
		const res = await fetch(
			`https://api.meta.ai/v1/asr/transcribe?sessionId=${encodeURIComponent(sessionId)}`,
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${META_API_KEY}` },
				body: form,
				signal: AbortSignal.timeout(120000)
			}
		);
		if (!res.ok) {
			const text = await res.text().catch(() => '');
			return json({
				status: 'error',
				message: `Transcribe API responded ${res.status}: ${text.slice(0, 300)}`
			});
		}
		const data = await res.json();
		const turns: TurnOut[] = Array.isArray(data?.turns)
			? data.turns.map(
					(
						t: { turnId?: unknown; startMs?: unknown; endMs?: unknown; transcript?: unknown; speaker?: unknown },
						i: number
					) => ({
						turnId: typeof t.turnId === 'number' ? t.turnId : i + 1,
						startMs: typeof t.startMs === 'number' ? t.startMs : 0,
						endMs: typeof t.endMs === 'number' ? t.endMs : 0,
						transcript: typeof t.transcript === 'string' ? t.transcript : '',
						speaker: typeof t.speaker === 'string' ? t.speaker : null
					})
				)
			: [];
		return json({
			status: 'ok',
			transcript: typeof data?.transcript === 'string' ? data.transcript : '',
			durationMs: typeof data?.audioDurationMs === 'number' ? data.audioDurationMs : 0,
			turns,
			sessionId: typeof data?.sessionId === 'string' ? data.sessionId : sessionId
		});
	} catch (err) {
		return json({
			status: 'error',
			message: err instanceof Error ? err.message : 'Transcription failed.'
		});
	}
};
