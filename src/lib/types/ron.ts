/*
 * RON (Real or Not) — Strict domain types.
 *
 * Design rule (PRD §2 Anti-Goals): the DEFAULT view must contain ZERO jargon.
 * All scientific fields live under `proof` and are only rendered inside
 * the `[ Show Proof ▾ ]` drawer. Simple-mode fields use plain English only.
 */

/** The 5 universal verdicts + 1 compression fallback. */
export type VerdictKey =
	| 'real'
	| 'filtered'
	| 'partial_ai'
	| 'twisted_story'
	| 'made_by_ai'
	| 'too_blurry';

export type SourceType = 'social_link' | 'file_upload' | 'live_call';

export type Platform =
	| 'tiktok'
	| 'x'
	| 'instagram'
	| 'youtube'
	| 'reddit'
	| 'zoom_meet'
	| 'phone_call'
	| 'upload';

/** Friendly badge metadata — universal across Light/Dark themes. */
export interface VerdictMeta {
	key: VerdictKey;
	/** Kaomoji face, e.g. `{ ^-^ }` */
	kaomoji: string;
	/** Short badge label, e.g. `Real` */
	label: string;
	/** 1-sentence plain-English explainer. */
	plainExplainer: string;
	/** Universal hex color (never themed). */
	color: string;
	/** Emoji dot for lists/notifications. */
	dot: string;
}

export const VERDICT_META: Record<VerdictKey, VerdictMeta> = {
	real: {
		key: 'real',
		kaomoji: '{ ^-^ }',
		label: 'Real',
		plainExplainer: 'Looks and sounds like a real camera and microphone.',
		color: '#10B981',
		dot: '🟢'
	},
	filtered: {
		key: 'filtered',
		kaomoji: '{ o_o }',
		label: 'Real, Just Filtered',
		plainExplainer: 'Real photo or video — just touched up with color filters or lighting.',
		color: '#F59E0B',
		dot: '🟡'
	},
	partial_ai: {
		key: 'partial_ai',
		kaomoji: '( ¬_¬ )',
		label: 'Partly Changed by AI',
		plainExplainer: 'Careful! Most of this is real, but one specific part was changed by AI.',
		color: '#F97316',
		dot: '🟠'
	},
	twisted_story: {
		key: 'twisted_story',
		kaomoji: '( o_¬ )',
		label: 'Real Video, Twisted Story',
		plainExplainer: 'The video and voice are real recordings, but stitched from different events or dates.',
		color: '#8B5CF6',
		dot: '🟣'
	},
	made_by_ai: {
		key: 'made_by_ai',
		kaomoji: '[ x_x ]',
		label: 'Made by AI',
		plainExplainer: 'Created entirely by artificial intelligence.',
		color: '#EF4444',
		dot: '🔴'
	},
	too_blurry: {
		key: 'too_blurry',
		kaomoji: '{ -_- }',
		label: 'Not Sure (Too Compressed)',
		plainExplainer:
			'This file is too compressed to call safely — an honest Not Sure beats a confident guess.',
		color: '#9CA3AF',
		dot: '⚪'
	}
};

/* ─── Simple Mode (zero jargon) ─────────────────────────────────────────── */

/** One step of the "Where This Came From" story breadcrumb. */
export interface StoryStep {
	/** Human date label, e.g. `Mar 2022` or `2 days ago`. */
	date: string;
	platform: string;
	/** Plain 1-sentence description of what happened at this step. */
	whatHappened: string;
}

export interface StoryHistory {
	steps: [StoryStep, StoryStep, StoryStep];
	/** Forward-looking plain warning, e.g. `Scammers may repost this with a fake donation link next.` */
	nextScamWarning: string;
}

/** Spatial bounding box for a highlighted video/image region (0–1 normalized). */
export interface HighlightedSpot {
	x: number;
	y: number;
	w: number;
	h: number;
	/** Plain label, e.g. `This sign was edited in by AI`. */
	plainLabel: string;
	isFake: boolean;
}

/** Truecaller-style audio time slice — used for calls, meetings AND videos. */
export type AudioSliceStatus = 'real' | 'ai_clone' | 'scam_script';

export interface AudioSlice {
	startSec: number;
	endSec: number;
	speakerLabel: string;
	status: AudioSliceStatus;
	/** Plain note, e.g. `Real human greeting` / `AI voice clone asking for money`. */
	plainNote: string;
	transcriptSnippet: string;
}

/* ─── Show Proof (hidden until user toggles) ─────────────────────────────── */

/** Meta SAM 3.1 mask telemetry for one segmented object. */
export interface SamMask {
	maskId: string;
	label: string;
	iouScore: number;
	elaDeltaSigma: number;
	fftPeakRatio: number;
	noiseprintKl: number;
}

/** One entry of the Meta AI model execution trace. */
export interface MetaModelTraceEntry {
	/** e.g. `sam-3.1`, `muse-wonder-1.0`, `muse-spark-1.3`, `muse-spark-open-1026`, `muse-glimmer`, `muse-voice-transcribe`, `muse-image` */
	model: string;
	/** Human stage name, e.g. `Pixel masks`, `Voice turns`. */
	stage: string;
	durationMs: number;
	/** Compact machine-readable output summary. */
	output: string;
}

export type JevDistribution = Record<
	'real' | 'filtered' | 'partial_ai' | 'twisted_story' | 'made_by_ai',
	number
>;

/** TypeSafe Jev System-1 RLCD parallel calibration. */
export interface JevCalibration {
	distribution: JevDistribution;
	/** Epistemic confidence band, e.g. `2.4` means ±2.4%. */
	epistemicBand: number;
	inferenceMs: number;
}

/** Alien Space blind-spot sampler (Fβ=0.7). */
export interface AlienSpace {
	coherenceZ: number;
	unavailabilityZ: number;
	fBetaScore: number;
	fBeta: number;
	blindSpotAtoms: string[];
}

/** Everything inside `[ Show Proof ▾ ]`. Never rendered in Simple Mode. */
export interface ProofBundle {
	samMasks: SamMask[];
	metaModelsTrace: MetaModelTraceEntry[];
	jevCalibration: JevCalibration;
	alienSpace: AlienSpace;
	/** Optional forensic X-ray plate image URL (Muse Image). */
	xrayPlateUrl?: string;
}

/* ─── Top-level scan result ─────────────────────────────────────────────── */

export interface MediaScanResult {
	id: string;
	title: string;
	/** Original URL or file name. */
	source: string;
	sourceType: SourceType;
	platform: Platform;
	verdict: VerdictKey;
	confidencePercent: number;
	/** Epoch ms. */
	scannedAt: number;

	/* Simple Mode — plain English only. */
	plainHeadline: string;
	whatsReal: string;
	whatsChanged: string;
	/** Per-scan tailored safety advice. Falls back to SAFETY_ACTION[verdict] when absent. */
	safetyAction?: string;
	whereItCameFrom: StoryHistory;
	highlightedSpots: HighlightedSpot[];
	audioSlices: AudioSlice[];
	/** Optional poster/thumbnail URL for the media stage. */
	posterUrl?: string;
	/** Optional playable audio (object/data URL) enabling REAL slice playback. */
	audioDataUrl?: string;
	/** Optional extracted video keyframes (data URLs) for the stage strip. */
	keyframes?: string[];

	/* Show Proof — hidden until toggled. */
	proof: ProofBundle;
}

/* ─── Convex row mirrors (local-first, synced when PUBLIC_CONVEX_URL set) ─ */

export interface ScanRow {
	mediaUrl: string;
	platform: Platform;
	verdictType: VerdictKey;
	plainSummary: string;
	highlightedRegions: HighlightedSpot[];
	storyTimeline: StoryStep[];
	proofDetails: ProofBundle;
	confidencePercent: number;
}

export interface ThreatHashRow {
	/** Perceptual image hash (pHash) of the forged region. */
	pHash: string;
	/** Audio spectral fingerprint of cloned slices. */
	audioFingerprint?: string;
	verdictType: VerdictKey;
	firstSeenAt: number;
	reportCount: number;
	plainNote: string;
}

export type BuddyMood = 'sleeping' | 'checking' | VerdictKey;

export interface BuddySessionRow {
	sessionId: string;
	status: BuddyMood;
	lastVerdict?: VerdictKey;
	lastPlainBubble?: string;
	mediaUrl?: string;
	updatedAt: number;
}

/* ─── Signal worker protocol (shared with forensics.worker.ts) ──────────── */

export interface ForensicsAnalyzeRequest {
	id: number;
	type: 'analyze';
	/** Raw RGBA pixels (transferred, not copied). */
	rgba: Uint8ClampedArray;
	width: number;
	height: number;
	elaQuality?: number;
	fftCutoff?: number;
}

export interface ForensicsAnalyzeResponse {
	id: number;
	type: 'result';
	/** 0–255 anomaly heat per pixel (Boundary ΔELA). */
	elaMap: Uint8ClampedArray;
	/** 0–255 AI grid-pattern strength per pixel (2D FFT). */
	fftMap: Uint8ClampedArray;
	/** 0/255 1-bit Bayer halftone dither mask. */
	ditherMask: Uint8ClampedArray;
	timings: { elaMs: number; fftMs: number; ditherMs: number; totalMs: number };
	engine: 'rust-wasm' | 'typescript-worker';
}

export type ForensicsWorkerIn = ForensicsAnalyzeRequest | { id: number; type: 'ping' };

export type ForensicsWorkerOut =
	| ForensicsAnalyzeResponse
	| { id: number; type: 'pong'; engine: 'rust-wasm' | 'typescript-worker' }
	| { id: number; type: 'error'; message: string };

/* ─── Phase 2: app modes, trust meter, safety actions (all plain English) ── */

/** Top-level workspace mode (Navbar center pills). */
export type AppMode = 'check' | 'call' | 'sim';

/**
 * "How much of this can you trust as-is?" — the authenticity meter baseline.
 * The `[ Hide the Fake Part ]` test Tweens this to ~99% to prove causality.
 */
export const TRUST_AS_IS: Record<VerdictKey, number> = {
	real: 99,
	filtered: 96,
	partial_ai: 18,
	twisted_story: 24,
	made_by_ai: 9,
	too_blurry: 40
};

/** Plain-English "What You Should Do" guidance per verdict. */
export const SAFETY_ACTION: Record<VerdictKey, string> = {
	real: 'Safe to trust and share.',
	filtered: 'Safe to share — download the Verified Human Receipt to prove a human made it.',
	partial_ai: 'Do not share the edited part — check the highlighted spots before believing the claim.',
	twisted_story: 'Do not repost this as breaking news — share the original date and source instead.',
	made_by_ai: 'Pause and verify through a second channel (Slack, phone, or in person) before acting on anything in this meeting or clip.',
	too_blurry: 'Ask for a clearer original before deciding — do not act on this copy.'
};

/** Human display labels for platforms (never leak SNAKE_CASE keys into UI). */
export const PLATFORM_LABEL: Record<Platform, string> = {
	tiktok: 'TikTok',
	x: 'X',
	instagram: 'Instagram',
	youtube: 'YouTube',
	reddit: 'Reddit',
	zoom_meet: 'Zoom / Meet',
	phone_call: 'Phone Call',
	upload: 'Upload'
};

/** Sigma formatter that never prints "-0.00" for near-zero divergence. */
export function formatSigma(v: number, digits = 2): string {
	const n = Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v;
	return n.toFixed(digits);
}

/** Word-boundary truncation with ellipsis (never cuts mid-word like slice()). */
export function truncateWords(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const cut = text.slice(0, maxChars - 1).trimEnd();
	const lastSpace = cut.lastIndexOf(' ');
	if (lastSpace <= 0) return `${cut}…`;
	return `${cut.slice(0, lastSpace)}…`;
}

/** Short pill labels for the 1-click sample strip. */
export const SAMPLE_SHORT_LABELS: Record<string, string> = {
	'sample-x-9821': 'X Partial Edit',
	'sample-meet-exec': '🎥 Zoom / Meet Executive Deepfake',
	'sample-tiktok-4419': 'TikTok Twisted Story',
	'sample-yt-laundry': 'YouTube Screen-Laundered AI'
};

/** X-Ray Loupe forensic layers (only visible with Show Proof ON). */
export type LoupeLayer = 'ela' | 'fft' | 'noise' | 'dither';

export const LOUPE_LAYERS: Record<LoupeLayer, { label: string; hint: string }> = {
	ela: { label: 'Compression Seams', hint: 'Bright edges = pasted regions' },
	fft: { label: 'AI Grid Patterns', hint: 'Bright tiles = synthetic texture' },
	noise: { label: 'Camera Sensor Noise', hint: 'Flat patches = denoised / fake' },
	dither: { label: '1-Bit Dither Matrix', hint: 'Broken grain = edited boundary' }
};
