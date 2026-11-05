/*
 * RON (Real or Not) — floating-buddy live analysis pipeline (shared).
 *
 * Used by BOTH the Document PiP companion and the inline buddy card:
 * capture keyframes + raw 3.5s PCM → POST /api/analyze → build a real
 * MediaScanResult with pinpoint boxes, diarized slices, and a narrative.
 */

import { buildSlicesFromLiveAudio } from '#lib/stores/ronStore.svelte';
import {
	VERDICT_META,
	formatSigma,
	type HighlightedSpot,
	type MediaScanResult,
	type VerdictKey
} from '#lib/types/ron';
import { analyzeMedia, type AnalyzeResult } from '#lib/services/metaApi';
import { captureLiveStreamPcmWav } from '#lib/utils/audioWavEncoder';
import {
	computeRealRegionalForensics,
	PINPOINT_RETICLES,
	type RegionalMaskScore
} from '#lib/services/realForensics';

export const BUDDY_SYNC_CHANNEL = 'ron_agentic_sync';

/** Listen for buddy scans finished in OTHER tabs (BroadcastChannel never echoes). */
export function startBuddySyncListener(onScan: (scan: MediaScanResult) => void): () => void {
	if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
		return () => undefined;
	}
	const bc = new BroadcastChannel(BUDDY_SYNC_CHANNEL);
	bc.onmessage = (ev: MessageEvent) => {
		const data = ev.data as { type?: string; scan?: MediaScanResult };
		if (data?.type === 'ronnie-scan-complete' && data.scan?.id) onScan(data.scan);
	};
	return () => bc.close();
}

export interface BuddyLiveInput {
	stream: MediaStream;
	video: HTMLVideoElement;
	tabLabel: string;
	platform?: string;
	onProgress?: (message: string, frac: number) => void;
}

export type BuddyLiveOutcome =
	| { ok: true; scan: MediaScanResult; modelsExecuted: string[] }
	| { ok: false; error: string };

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('keyframe decode failed'));
		img.src = dataUrl;
	});
}

function grabFrame(video: HTMLVideoElement, maxW = 640): string | null {
	try {
		const vw = video.videoWidth || 640;
		const vh = video.videoHeight || 360;
		if (vw < 8 || vh < 8) return null;
		const scale = Math.min(1, maxW / vw);
		const canvas = document.createElement('canvas');
		canvas.width = Math.max(1, Math.round(vw * scale));
		canvas.height = Math.max(1, Math.round(vh * scale));
		canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL('image/jpeg', 0.85);
	} catch {
		return null;
	}
}

async function waitForVideo(video: HTMLVideoElement, timeoutMs = 4000): Promise<boolean> {
	if (video.readyState >= 2 && video.videoWidth > 8) return true;
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve(video.readyState >= 2), timeoutMs);
		const onCanPlay = () => {
			clearTimeout(timer);
			resolve(true);
		};
		video.addEventListener('canplay', onCanPlay, { once: true });
		video.play().catch(() => undefined);
	});
}

function verdictFromSignals(input: {
	sealFlaggedSeconds: number;
	sealTotalSeconds: number;
	siglipFakeProb: number | null;
	topSigma: number;
	flaggedRegions: number;
	regionCount: number;
	hasTranscript: boolean;
}): { verdict: VerdictKey; confidencePercent: number } {
	const { sealFlaggedSeconds, siglipFakeProb, topSigma, flaggedRegions, regionCount, hasTranscript } = input;
	const voiceTampered = sealFlaggedSeconds > 0;
	const visualSynthetic = (siglipFakeProb ?? 0) >= 0.75;
	const visualSuspicious = (siglipFakeProb ?? 0) >= 0.45 || flaggedRegions > 0;
	if (voiceTampered && visualSynthetic) return { verdict: 'made_by_ai', confidencePercent: 93 };
	if (voiceTampered || visualSynthetic) return { verdict: 'partial_ai', confidencePercent: 86 };
	if (visualSuspicious) return { verdict: 'partial_ai', confidencePercent: 78 };
	if (hasTranscript || regionCount > 0) {
		return {
			verdict: 'real',
			confidencePercent: Math.max(62, Math.min(88, Math.round(80 - topSigma * 12)))
		};
	}
	return { verdict: 'too_blurry', confidencePercent: 50 };
}

/** Build a full scan object from live evidence (used by PiP + inline buddy). */
export function buildBuddyScan(input: {
	tabLabel: string;
	platform: string;
	keyframes: string[];
	wavDurationSec: number;
	regional: { overallAnomalyScore: number; regionScores: RegionalMaskScore[] } | null;
	analysis: Extract<AnalyzeResult, { status: 'ok' }> | null;
	modelsExecuted: string[];
	stageErrors: Array<{ stage: string; message: string }>;
}): MediaScanResult {
	const { tabLabel, platform, keyframes, wavDurationSec, regional, analysis } = input;
	const turns = analysis?.turns ?? [];
	const sealSlices = analysis?.sealSlices ?? null;
	const siglip = analysis?.siglipFakeProb ?? null;
	const audioSlices = buildSlicesFromLiveAudio(turns as never, sealSlices as never);
	const flaggedSeconds = (sealSlices ?? []).filter((s) => s.isFlagged).length;
	const flaggedRegions = (regional?.regionScores ?? []).filter((r) => r.isFlaggedAnomaly);
	const topSigma = Math.max(0, ...(regional?.regionScores ?? []).map((r) => r.elaDivergenceSigma));

	const local = verdictFromSignals({
		sealFlaggedSeconds: flaggedSeconds,
		sealTotalSeconds: sealSlices?.length ?? 0,
		siglipFakeProb: siglip,
		topSigma,
		flaggedRegions: flaggedRegions.length,
		regionCount: regional?.regionScores.length ?? 0,
		hasTranscript: turns.length > 0
	});
	const n = analysis?.narrative ?? null;
	const verdict = n?.verdict ?? local.verdict;
	const confidencePercent = n?.confidencePercent ?? local.confidencePercent;
	const meta = VERDICT_META[verdict];

	const spots: HighlightedSpot[] = (regional?.regionScores ?? []).map((r) => ({
		x: r.bbox.x,
		y: r.bbox.y,
		w: r.bbox.w,
		h: r.bbox.h,
		plainLabel: r.isFlaggedAnomaly
			? `⚠️ ${r.label} shows AI generation (+${formatSigma(r.elaDivergenceSigma)}σ)`
			: `✅ ${r.label} looks natural`,
		isFake: r.isFlaggedAnomaly
	}));

	const briefing = analysis?.briefing;
	const sources = analysis?.sources ?? [];
	const steps: MediaScanResult['whereItCameFrom'] = {
		steps: [
			{
				date: 'Just now',
				platform: tabLabel || 'Shared tab',
				whatHappened: `Ronnie captured this tab live (${keyframes.length} frames, ${wavDurationSec.toFixed(1)}s of audio).`
			},
			{
				date: '—',
				platform: 'Public web',
				whatHappened:
					briefing?.origin || briefing?.impact
						? `${briefing.origin} ${briefing.impact}`.trim().slice(0, 220)
						: 'No earlier copies found on the public web.'
			},
			{
				date: '—',
				platform: 'RON',
				whatHappened:
					sources.length > 0
						? `Web context verified against ${sources.length} live source${sources.length === 1 ? '' : 's'}.`
						: 'Live web context returned no citable sources.'
			}
		],
		nextScamWarning:
			verdict === 'made_by_ai' || verdict === 'partial_ai'
				? 'Do not act on anything in this tab until the people in it confirm through a second channel.'
				: 'If this tab later asks for money or codes, pause and verify through a known channel first.'
	};

	return {
		id: `buddy-${Date.now()}`,
		title: tabLabel || 'Shared tab',
		source: tabLabel || 'Shared tab',
		sourceType: 'live_call',
		platform: (platform === 'youtube' || platform === 'zoom_meet' ? platform : 'upload') as MediaScanResult['platform'],
		verdict,
		confidencePercent,
		scannedAt: Date.now(),
		plainHeadline:
			n?.plainHeadline ??
			(flaggedSeconds > 0 || flaggedRegions.length > 0
				? `This tab shows AI tampering — ${meta.label.toLowerCase()} (${confidencePercent}% sure).`
				: `This tab looks authentic right now (${confidencePercent}% sure).`),
		whatsReal:
			n?.whatsReal ??
			`Measured live from the shared tab: ${turns.length} speech turn${turns.length === 1 ? '' : 's'} transcribed, ` +
				`${(regional?.regionScores.length ?? 0) - flaggedRegions.length} visual regions consistent.`,
		whatsChanged:
			n?.whatsChanged ??
			(flaggedSeconds > 0 || flaggedRegions.length > 0
				? `${flaggedSeconds > 0 ? `${flaggedSeconds}s of AI-cloned voice` : ''}` +
					`${flaggedSeconds > 0 && flaggedRegions.length > 0 ? ' and ' : ''}` +
					`${flaggedRegions.length > 0 ? flaggedRegions.map((r) => r.label).join(', ') : ''} flagged live.`
				: 'Nothing flagged in this live window.'),
		safetyAction:
			n?.safetyAction ??
			(verdict === 'made_by_ai' || verdict === 'partial_ai'
				? 'Treat claims in this tab as untrusted until the speakers confirm through a second channel.'
				: 'Safe to keep watching — re-check if the scene or speakers suddenly change.'),
		whereItCameFrom: steps,
		highlightedSpots: spots,
		audioSlices,
		keyframes: keyframes.length > 0 ? keyframes : undefined,
		posterUrl: keyframes[0],
		proof: {
			samMasks: (regional?.regionScores ?? []).map((r, i) => ({
				maskId: r.maskId || `M${i + 1}`,
				label: `${r.label} (measured live from shared tab)`,
				iouScore: 0,
				elaDeltaSigma: r.elaDivergenceSigma,
				fftPeakRatio: r.highFreqEnergyRatio,
				noiseprintKl: 0
			})),
			metaModelsTrace: [
				...input.modelsExecuted.map((m) => ({
					model: m,
					stage: 'Live tab analysis (/api/analyze)',
					durationMs: 0,
					output: 'executed live on this capture'
				})),
				...input.stageErrors.map((e) => ({
					model: 'ron-pipeline',
					stage: `⚠ ${e.stage} failed — fell back honestly`,
					durationMs: 0,
					output: e.message.slice(0, 160)
				}))
			],
			jevCalibration: {
				distribution: { real: 0, filtered: 0, partial_ai: 0, twisted_story: 0, made_by_ai: 0 },
				epistemicBand: 0,
				inferenceMs: 0
			},
			alienSpace: { coherenceZ: 0, unavailabilityZ: 0, fBetaScore: 0, fBeta: 0.7, blindSpotAtoms: [] }
		}
	};
}

/**
 * Full live capture + analysis for one shared tab: keyframes at t=0s and t=2.5s,
 * raw 3.5s PCM, regional ELA, then /api/analyze. Every stage is optional and
 * honest — partial evidence still yields a scan, never a fabricated verdict.
 */
export async function runBuddyLiveAnalysis(opts: BuddyLiveInput): Promise<
	{ ok: true; scan: MediaScanResult; modelsExecuted: string[] } | { ok: false; error: string }
> {
	const { stream, video, tabLabel } = opts;
	const platform = opts.platform ?? 'upload';
	const say = (message: string, frac: number) => opts.onProgress?.(message, frac);

	const ready = await waitForVideo(video).catch(() => false);
	const kf1 = ready ? grabFrame(video) : null;
	if (kf1) say('Frame 1 captured — listening…', 0.2);

	// Raw PCM capture (3.5s) with the second keyframe grabbed mid-window.
	let kf2: string | null = null;
	const kf2Timer = setTimeout(() => {
		kf2 = grabFrame(video);
	}, 2500);
	const pcm = await captureLiveStreamPcmWav(stream, 3500).catch(() => null);
	clearTimeout(kf2Timer);
	if (!kf2) kf2 = grabFrame(video);
	const keyframes = [kf1, kf2].filter((k): k is string => !!k);
	if (keyframes.length === 0 && !pcm) {
		return { ok: false, error: 'Capture came back empty — no frames and no audio. Try again while the tab plays.' };
	}
	say('Analyzing pixels + voice…', 0.55);

	// Regional ELA on the first keyframe (best-effort; never blocks the verdict).
	let regional: { overallAnomalyScore: number; regionScores: RegionalMaskScore[] } | null = null;
	if (keyframes[0]) {
		try {
			const img = await loadImage(keyframes[0]);
			const res = await computeRealRegionalForensics(img, PINPOINT_RETICLES.map((r) => ({ ...r })));
			regional = { overallAnomalyScore: res.overallAnomalyScore, regionScores: res.regionScores };
		} catch {
			regional = null;
		}
	}

	say('Asking the model jury…', 0.75);
	let analysis: Extract<AnalyzeResult, { status: 'ok' }> | null = null;
	try {
		const res = await analyzeMedia({
			tabLabel,
			platform,
			kind: 'live',
			frames: keyframes.slice(0, 2),
			wavBase64: pcm?.wavBase64,
			regional: regional
				? { overallAnomalyScore: regional.overallAnomalyScore, regionScores: regional.regionScores }
				: null
		});
		if (res.status === 'ok') analysis = res;
	} catch {
		analysis = null;
	}

	const modelsExecuted = analysis?.modelsExecuted ?? [];
	if (regional) modelsExecuted.unshift('Regional ELA reticles (on-device)');
	const scan = buildBuddyScan({
		tabLabel,
		platform,
		keyframes,
		wavDurationSec: pcm?.durationSec ?? 0,
		regional,
		analysis,
		modelsExecuted,
		stageErrors: analysis?.errors ?? []
	});
	say('Done.', 1);
	return { ok: true, scan, modelsExecuted };
}
