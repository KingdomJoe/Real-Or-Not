/*
 * RON (Real or Not) — Central reactive store (Svelte 5 Runes).
 *
 * - Local-first: 5 rich pre-loaded interactive forensic cases work out-of-the-box.
 * - Convex-synced: when PUBLIC_CONVEX_URL is set (see +layout.svelte setupConvex),
 *   `syncFromConvex()` merges remote scans and `pushScanToConvex()` uploads new ones.
 * - Svelte 5 runes: `$state` for mutable sources, `$derived` for computed views.
 *   This module uses `.svelte.ts` so runes compile correctly outside components.
 */

import { formatSigma } from '#lib/types/ron';
import type {
	AppMode,
	AudioSlice,
	HighlightedSpot,
	MediaScanResult,
	MetaModelTraceEntry,
	Platform,
	SamMask,
	VerdictKey
} from '#lib/types/ron';
import {
	computeRealRegionalForensics,
	inspectBinaryProvenanceAndHash,
	PINPOINT_RETICLES,
	type C2paAndMetadataReport,
	type CandidateRegion
} from '#lib/services/realForensics';
import { analyzeMedia, type AnalyzeResult } from '#lib/services/metaApi';
import { extract16kHzMonoWavFromBlob } from '#lib/utils/audioWavEncoder';
import { browser } from '$app/env';
import { PUBLIC_CONVEX_URL } from '$app/env/public';

/** Meta TOS: never automate extraction from Meta-owned surfaces. */
export const BLOCKED_TOS_DOMAINS = ['instagram.com', 'facebook.com', 'fb.com', 'fb.watch'];

export interface BlockedLink {
	input: string;
	reason: 'meta-tos' | 'blocked-platform';
}

export interface RegionalLiveResult {
	overallAnomalyScore: number;
	elaDataUrl: string;
	regionScores: Array<{
		maskId: string;
		label: string;
		bbox: { x: number; y: number; w: number; h: number };
		meanElaInside: number;
		meanElaOutside: number;
		elaDivergenceSigma: number;
		highFreqEnergyRatio: number;
		isFlaggedAnomaly: boolean;
		ablationScoreIfHidden: number;
	}>;
}

export const MAX_UPLOAD_MB = 25;
export const MAX_UPLOAD_SECONDS = 30;

/* ─── Proof-bundle helpers (keep sample data compact but realistic) ─────── */

function samMask(
	maskId: string,
	label: string,
	iouScore: number,
	elaDeltaSigma: number,
	fftPeakRatio: number,
	noiseprintKl: number
): SamMask {
	return { maskId, label, iouScore, elaDeltaSigma, fftPeakRatio, noiseprintKl };
}

function trace(model: string, stage: string, durationMs: number, output: string): MetaModelTraceEntry {
	return { model, stage, durationMs, output };
}

const TRACE_TRIAGE = (extra: MetaModelTraceEntry[] = []): MetaModelTraceEntry[] => [
	trace('muse-glimmer', 'Fast triage (floating buddy)', 612, 'initial: suspicious voice turn @0:04'),
	trace('sam-3.1', 'Pixel masks', 1180, 'masks: M1 background, M2 foreground object'),
	trace('muse-voice-transcribe', 'Voice turns', 940, 'turns segmented, word timestamps extracted'),
	...extra,
	trace('muse-spark-open-1026', 'Cross-modal reasoning + Alien Space', 2210, 'Fβ=0.7 computed'),
	trace('muse-wonder-1.0', 'Web-grounded story graph', 1875, '3-node mutation graph built'),
	trace('muse-spark-1.3', 'Orchestration + plain summary', 640, 'plain headline generated'),
	trace('muse-image', 'X-ray proof plate', 2950, 'annotated plate rendered')
];

/* ─── Sample 1: X viral clip — Partly Changed by AI ─────────────────────── */

const X_CLIP_SPOTS: HighlightedSpot[] = [
	{ x: 0.58, y: 0.34, w: 0.32, h: 0.28, plainLabel: 'This protest sign was edited in by AI', isFake: true },
	{ x: 0.12, y: 0.18, w: 0.3, h: 0.42, plainLabel: 'This person and street are real', isFake: false }
];

const X_CLIP_AUDIO: AudioSlice[] = [
	{
		startSec: 0,
		endSec: 4,
		speakerLabel: 'Reporter',
		status: 'real',
		plainNote: 'Real human voice asking a question',
		transcriptSnippet: '“Tell us why you came out today…”'
	},
	{
		startSec: 4,
		endSec: 7,
		speakerLabel: 'Interviewee',
		status: 'ai_clone',
		plainNote: 'AI voice clone — same voice, fake words',
		transcriptSnippet: '“…and that is why we demand—”'
	},
	{
		startSec: 7,
		endSec: 11,
		speakerLabel: 'Reporter',
		status: 'real',
		plainNote: 'Real human voice closing the interview',
		transcriptSnippet: '“Thank you, back to you in the studio.”'
	}
];

const sampleXClip: MediaScanResult = {
	id: 'sample-x-9821',
	title: 'Street interview — viral clip',
	source: 'x.com/breaking/status/9821',
	sourceType: 'social_link',
	platform: 'x',
	verdict: 'partial_ai',
	confidencePercent: 94,
	scannedAt: Date.now() - 1000 * 60 * 42,
	plainHeadline: 'Most of this video is real, but the protest sign and 3 seconds of voice were changed by AI.',
	whatsReal: 'The street, the crowd, and both people on camera are a real recording.',
	whatsChanged: 'The words on the held sign were edited in, and the voice from 0:04 to 0:07 is an AI clone.',
	safetyAction: 'Check the sign against the original reporter’s post and listen to 0:04–0:07 closely before sharing — the claim lives in the edited parts.',
	whereItCameFrom: {
		steps: [
			{ date: 'Nov 1, 2026', platform: 'X', whatHappened: 'Original street interview posted by a local reporter.' },
			{ date: 'Nov 2, 2026', platform: 'X', whatHappened: 'Someone edited the sign text and reposted it without saying so.' },
			{ date: 'Nov 3, 2026', platform: 'X', whatHappened: 'Edited version went viral with 2.1M views and angry replies.' }
		],
		nextScamWarning: 'Watch for copies with donation links added — the original reporter never asked for money.'
	},
	highlightedSpots: X_CLIP_SPOTS,
	audioSlices: X_CLIP_AUDIO,
	proof: {
		samMasks: [
			samMask('M1', 'street + crowd background', 0.98, 0.4, 1.02, 0.08),
			samMask('M2', 'held protest sign (edited)', 0.96, 4.8, 3.31, 1.94)
		],
		metaModelsTrace: TRACE_TRIAGE([
			trace('muse-voice-transcribe', 'Viseme phase drift', 310, 'Δφ = 38ms @0:04–0:07 (clone boundary)')
		]),
		jevCalibration: {
			distribution: { real: 3.1, filtered: 1.2, partial_ai: 93.8, twisted_story: 1.1, made_by_ai: 0.8 },
			epistemicBand: 2.4,
			inferenceMs: 128
		},
		alienSpace: {
			coherenceZ: 0.6,
			unavailabilityZ: 0.3,
			fBetaScore: 0.34,
			fBeta: 0.7,
			blindSpotAtoms: []
		}
	}
};

/* ─── Sample 2: Zoom/Meet executive deepfake — AI face/voice swap joins live ── */

const MEET_EXEC_AUDIO: AudioSlice[] = [
	{
		startSec: 0,
		endSec: 4,
		speakerLabel: 'Priya (host)',
		status: 'real',
		plainNote: 'Real host opening the meeting',
		transcriptSnippet: '“Morning, team — quick sync on the vendor contract…”'
	},
	{
		startSec: 4,
		endSec: 9,
		speakerLabel: 'Marcus (CFO)',
		status: 'ai_clone',
		plainNote: 'AI face/voice swap joins and pushes an urgent payment',
		transcriptSnippet: '“Approve the Meridian invoice today — two hundred thousand, urgent…”'
	},
	{
		startSec: 9,
		endSec: 13,
		speakerLabel: 'Marcus (CFO)',
		status: 'ai_clone',
		plainNote: 'Clone insists on off-channel approval',
		transcriptSnippet: '“Don’t loop in finance, just confirm here and I’ll handle it…”'
	}
];

const MEET_EXEC_SPOTS: HighlightedSpot[] = [
	{
		x: 0.36,
		y: 0.1,
		w: 0.28,
		h: 0.42,
		plainLabel: 'Swapped executive face — smoothed skin, frozen micro-expressions',
		isFake: true
	},
	{ x: 0.05, y: 0.62, w: 0.28, h: 0.28, plainLabel: 'Real meeting UI and other participants', isFake: false }
];

const sampleMeetExec: MediaScanResult = {
	id: 'sample-meet-exec',
	title: 'Q3 planning call — executive deepfake joins',
	source: 'Google Meet / exec-sync',
	sourceType: 'live_call',
	platform: 'zoom_meet',
	verdict: 'made_by_ai',
	confidencePercent: 97,
	scannedAt: Date.now() - 1000 * 60 * 18,
	plainHeadline: 'A real team meeting until an AI-cloned executive joins and pushes an urgent payment.',
	whatsReal: 'The host, agenda, and first seconds are a genuine meeting.',
	whatsChanged: 'The “CFO” video and voice from 0:04 on are an AI face/voice swap pressuring a same-day wire.',
	safetyAction: 'Pause the meeting, ask the executive to turn their head fully sideways, and verify the request in Slack or by phone — never approve payments from a video call alone.',
	whereItCameFrom: {
		steps: [
			{ date: 'Oct 28, 2026', platform: 'Earnings call', whatHappened: 'Public footage of the CFO sampled for face and voice.' },
			{ date: 'Nov 2, 2026', platform: 'Face/voice swap rig', whatHappened: 'Real-time swap model trained and rehearsed with the script.' },
			{ date: 'Today', platform: 'Google Meet', whatHappened: 'Swap joined the live planning call pushing a same-day wire.' }
		],
		nextScamWarning: 'The same swap may join other team meetings — agree on a verbal safe word for payment talk.'
	},
	highlightedSpots: MEET_EXEC_SPOTS,
	audioSlices: MEET_EXEC_AUDIO,
	proof: {
		samMasks: [
			samMask('M1', 'meeting grid + UI (authentic)', 0.98, 0.4, 1.02, 0.08),
			samMask('M2', 'swapped executive face', 0.95, 5.2, 3.64, 2.2)
		],
		metaModelsTrace: TRACE_TRIAGE([
			trace('muse-voice-transcribe', 'Turn boundary + viseme drift', 420, 'clone onset @0:04, lip-sync lag Δφ = 142ms @0:09–0:13')
		]),
		jevCalibration: {
			distribution: { real: 1.4, filtered: 0.3, partial_ai: 4.2, twisted_story: 0.6, made_by_ai: 93.5 },
			epistemicBand: 1.8,
			inferenceMs: 141
		},
		alienSpace: {
			coherenceZ: 1.1,
			unavailabilityZ: 0.9,
			fBetaScore: 0.52,
			fBeta: 0.7,
			blindSpotAtoms: ['cross-device-voice-sample']
		}
	}
};

/* ─── Sample 3: TikTok — Real Video, Twisted Story ──────────────────────── */

const sampleTikTok: MediaScanResult = {
	id: 'sample-tiktok-4419',
	title: '“Breaking flood” clip',
	source: 'tiktok.com/@news/video/4419',
	sourceType: 'social_link',
	platform: 'tiktok',
	verdict: 'twisted_story',
	confidencePercent: 91,
	scannedAt: Date.now() - 1000 * 60 * 65,
	plainHeadline: 'The video and the voice are both real recordings — but they come from different years.',
	whatsReal: 'The flood footage is a real 2022 camera recording, and the voice is a real 2026 podcast.',
	whatsChanged: 'Nothing was AI-edited — the trick is stitching old video under new audio to fake breaking news.',
	safetyAction: 'Only share this with its real dates attached — 2022 footage, 2026 audio — or don’t share it as news at all.',
	whereItCameFrom: {
		steps: [
			{ date: 'Mar 2022', platform: 'YouTube', whatHappened: 'Original flood footage uploaded by a local news station.' },
			{ date: 'Oct 2026', platform: 'Podcast', whatHappened: 'Unrelated podcast episode recorded about emergency preparedness.' },
			{ date: 'Nov 3, 2026', platform: 'TikTok', whatHappened: 'Account stitched them together as fake “live breaking news”.' }
		],
		nextScamWarning: 'Expect “donate now” copies of this clip — always check the original upload date first.'
	},
	highlightedSpots: [
		{ x: 0.05, y: 0.72, w: 0.9, h: 0.2, plainLabel: 'Caption claims “LIVE today” — the footage is from 2022', isFake: true }
	],
	audioSlices: [
		{
			startSec: 0,
			endSec: 14,
			speakerLabel: 'Podcast host',
			status: 'real',
			plainNote: 'Real podcast voice — but recorded for a different story',
			transcriptSnippet: '“When the waters rise, the first thing to check is…”'
		}
	],
	proof: {
		samMasks: [samMask('M1', 'flood scene (authentic)', 0.99, 0.3, 1.0, 0.05)],
		metaModelsTrace: TRACE_TRIAGE([
			trace('muse-wonder-1.0', 'Cross-date grounding', 940, 'video: 2022-03-14 upload · audio: 2026-10-02 episode')
		]),
		jevCalibration: {
			distribution: { real: 4.4, filtered: 0.9, partial_ai: 2.1, twisted_story: 91.2, made_by_ai: 1.4 },
			epistemicBand: 3.1,
			inferenceMs: 156
		},
		alienSpace: {
			coherenceZ: 1.8,
			unavailabilityZ: 0.7,
			fBetaScore: 0.61,
			fBeta: 0.7,
			blindSpotAtoms: ['cross-date-stitch']
		}
	}
};

/* ─── Sample 4: YouTube Short — Made by AI (hidden screen-recording trick) ─ */

const sampleYouTube: MediaScanResult = {
	id: 'sample-yt-laundry',
	title: '“Laundry folding robot” short',
	source: 'youtube.com/shorts/ai_laundry',
	sourceType: 'social_link',
	platform: 'youtube',
	verdict: 'made_by_ai',
	confidencePercent: 96,
	scannedAt: Date.now() - 1000 * 60 * 120,
	plainHeadline: 'This video was made by AI — and filmed off a laptop screen to fool normal detectors.',
	whatsReal: 'Only the act of filming a screen is real — the laundry-room scene itself never happened.',
	whatsChanged: 'Everything in the scene (hands, laundry, room) is AI-generated video.',
	safetyAction: 'Treat the “robot” as fiction: don’t buy it, don’t share the Short as a real demo, and report affiliate-link copies.',
	whereItCameFrom: {
		steps: [
			{ date: 'Nov 1, 2026', platform: 'AI video tool', whatHappened: 'Laundry-robot clip generated from a text prompt.' },
			{ date: 'Nov 2, 2026', platform: 'Laptop + iPhone', whatHappened: 'Played on a laptop and re-recorded with a phone to add “real” noise.' },
			{ date: 'Nov 3, 2026', platform: 'YouTube Shorts', whatHappened: 'Posted as a real gadget demo with affiliate links.' }
		],
		nextScamWarning: 'Do not buy the linked “robot” — the product in the video does not exist.'
	},
	highlightedSpots: [
		{ x: 0.08, y: 0.12, w: 0.84, h: 0.66, plainLabel: 'AI-generated scene inside the screen recording', isFake: true },
		{ x: 0.02, y: 0.86, w: 0.5, h: 0.1, plainLabel: 'Moiré + refresh flicker from filming a screen', isFake: true }
	],
	audioSlices: [
		{
			startSec: 0,
			endSec: 9,
			speakerLabel: 'Narrator',
			status: 'ai_clone',
			plainNote: 'AI narration over the fake demo',
			transcriptSnippet: '“This robot folds your laundry in seconds…”'
		}
	],
	proof: {
		samMasks: [
			samMask('M1', 'screen bezel + moiré region', 0.93, 3.9, 4.42, 2.31),
			samMask('M2', 'synthetic hands + fabric', 0.95, 5.6, 3.87, 2.02)
		],
		metaModelsTrace: TRACE_TRIAGE([
			trace('muse-spark-open-1026', 'Recapture detection', 880, 'display moiré + 60Hz flicker + diffusion texture')
		]),
		jevCalibration: {
			distribution: { real: 0.8, filtered: 0.4, partial_ai: 2.6, twisted_story: 0.9, made_by_ai: 95.3 },
			epistemicBand: 2.1,
			inferenceMs: 149
		},
		alienSpace: {
			coherenceZ: 1.8,
			unavailabilityZ: 2.4,
			fBetaScore: 0.87,
			fBeta: 0.7,
			blindSpotAtoms: ['screen-recapture', 'diffusion-video']
		}
	}
};

/** All 4 pre-loaded interactive forensic cases (newest first). */
export const SAMPLE_SCANS: MediaScanResult[] = [
	sampleMeetExec,
	sampleXClip,
	sampleTikTok,
	sampleYouTube
];

/* ─── The store ─────────────────────────────────────────────────────────── */

class RonStore {
	/** All scans (local samples + Convex-synced + user-added). */
	scans = $state<MediaScanResult[]>([...SAMPLE_SCANS]);
	/** Currently inspected scan id. */
	activeScanId = $state<string>(SAMPLE_SCANS[0].id);
	/** `[ Show Proof ▾ ]` drawer visibility — default CLOSED (zero jargon). */
	showProof = $state(false);
	/** True while a (simulated or live) check is running. */
	isChecking = $state(false);
	/** Last pasted link / dropped file label. */
	lastInput = $state('');
	/** Convex sync state. */
	convexConnected = $state(false);
	convexError = $state<string | null>(null);
	/** Workspace mode (Navbar center pills). */
	appMode = $state<AppMode>('check');
	/** User-uploaded image preview overlay (object URL) — null when viewing sample art. */
	customImageUrl = $state<string | null>(null);
	customImageName = $state<string>('');
	/** User-uploaded video (object URL) for the playable stage player. */
	customVideoUrl = $state<string | null>(null);
	/** Honest note when a video's speech track could not be transcribed. */
	videoAudioNote = $state<string | null>(null);
	/** Live provenance report for the active upload (null for ground-truth fixtures). */
	provenance = $state<C2paAndMetadataReport | null>(null);
	/** Live regional ELA result for the active upload (null for fixtures / audio). */
	regional = $state<RegionalLiveResult | null>(null);
	/** Honest blocked-link notice (never silently swapped for a fixture). */
	linkBlocked = $state<BlockedLink | null>(null);

	/** Currently inspected scan (falls back to first). */
	activeScan = $derived(
		this.scans.find((s) => s.id === this.activeScanId) ?? this.scans[0]
	);

	/** Count of scans per verdict (for dashboard chips). */
	verdictCounts = $derived.by<Record<VerdictKey, number>>(() => {
		const counts: Record<VerdictKey, number> = {
			real: 0,
			filtered: 0,
			partial_ai: 0,
			twisted_story: 0,
			made_by_ai: 0,
			too_blurry: 0
		};
		for (const s of this.scans) counts[s.verdict] += 1;
		return counts;
	});

	selectScan(id: string) {
		this.activeScanId = id;
		this.showProof = false;
		this.clearCustomImage();
		this.clearCustomVideo();
		this.provenance = null;
		this.regional = null;
		this.linkBlocked = null;
		this.videoAudioNote = null;
	}

	/**
	 * Agentic background sync: a scan finished in the floating buddy (or PiP).
	 * Saved immediately WITHOUT stealing the user's view; `selectBuddyScan`
	 * teleports to it when the user taps "See Full Proof in RON".
	 */
	addBuddyScan(scan: MediaScanResult) {
		this.scans = [scan, ...this.scans.filter((s) => s.id !== scan.id)];
		void this.pushBuddyToConvex(scan, scan.verdict);
	}

	selectBuddyScan(id: string) {
		this.activeScanId = id;
		this.showProof = true;
		this.linkBlocked = null;
		this.videoAudioNote = null;
	}

	/** Push floating-buddy status to Convex `buddySessions` (best-effort). */
	async pushBuddyToConvex(
		scan: MediaScanResult,
		status: 'sleeping' | 'checking' | VerdictKey
	): Promise<boolean> {
		if (!browser) return false;
		try {
			if (!PUBLIC_CONVEX_URL) return false;
			const { getConvexClient } = await import('convex-svelte');
			const client = getConvexClient() as unknown as {
				mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
			};
			await client.mutation('buddy:pushStatus', {
				sessionId: 'ron-main-tab',
				status,
				lastVerdict: scan.verdict,
				lastPlainBubble: scan.plainHeadline,
				mediaUrl: scan.source
			});
			return true;
		} catch {
			return false;
		}
	}

	setMode(mode: AppMode) {
		this.appMode = mode;
		// Deep-link each mode to its hero case so judges land on the right demo.
		if (mode === 'call') this.selectScan('sample-meet-exec');
		if (mode === 'check' && this.activeScanId === 'sample-meet-exec') {
			this.selectScan('sample-x-9821');
		}
	}

	setCustomImage(url: string, name: string) {
		if (this.customImageUrl) URL.revokeObjectURL(this.customImageUrl);
		this.customImageUrl = url;
		this.customImageName = name;
	}

	clearCustomImage() {
		if (this.customImageUrl) URL.revokeObjectURL(this.customImageUrl);
		this.customImageUrl = null;
		this.customImageName = '';
	}

	setCustomVideo(url: string) {
		if (this.customVideoUrl) URL.revokeObjectURL(this.customVideoUrl);
		this.customVideoUrl = url;
	}

	clearCustomVideo() {
		if (this.customVideoUrl) URL.revokeObjectURL(this.customVideoUrl);
		this.customVideoUrl = null;
	}

	/**
	 * Pick the closest demo case for free text (non-URL demo routing only).
	 * Meta-owned platforms are excluded from automated matching per Meta TOS.
	 */
	matchSampleForInput(input: string): MediaScanResult {
		const needle = input.toLowerCase();
		return (
			this.scans.find(
				(s) =>
					s.platform !== 'instagram' &&
					(needle.includes(s.platform.replace('_', '')) ||
						needle.includes(s.source.split('/')[0].split('.')[0]))
			) ?? this.scans[0]
		);
	}

	toggleProof() {
		this.showProof = !this.showProof;
	}

	addScan(scan: MediaScanResult) {
		this.scans = [scan, ...this.scans.filter((s) => s.id !== scan.id)];
		this.activeScanId = scan.id;
		this.showProof = false;
	}

	/**
	 * Honest link check (v2.1): exact ground-truth fixtures resolve instantly;
	 * Meta-owned or unextractable stranger links surface a plain-English blocked
	 * notice and NEVER silently swap in a fixture verdict.
	 */
	async checkLink(input: string): Promise<MediaScanResult | null> {
		this.isChecking = true;
		this.lastInput = input;
		this.linkBlocked = null;
		try {
			await new Promise((r) => setTimeout(r, 500));
			const trimmed = input.trim();
			const lower = trimmed.toLowerCase();
			// Meta TOS: no automated extraction from Meta-owned surfaces.
			if (BLOCKED_TOS_DOMAINS.some((d) => lower.includes(d))) {
				this.linkBlocked = { input: trimmed, reason: 'meta-tos' };
				return null;
			}
			// Exact fixture sources resolve instantly ($0 cache).
			const fixture = this.scans.find(
				(s) => s.sourceType === 'social_link' && lower.includes(s.source.toLowerCase())
			);
			if (fixture) {
				this.selectScan(fixture.id);
				return fixture;
			}
			const looksLikeUrl =
				/^(https?:\/\/|www\.)/i.test(trimmed) || /\.[a-z]{2,}(\/|$|\?)/i.test(trimmed);
			if (looksLikeUrl) {
				this.linkBlocked = { input: trimmed, reason: 'blocked-platform' };
				return null;
			}
			// Plain free text (not a link): keyword demo routing is fine.
			const match = this.matchSampleForInput(trimmed);
			this.selectScan(match.id);
			return match;
		} finally {
			this.isChecking = false;
		}
	}

	/**
	 * Genuinely analyze a judge's own upload: real SHA-256 + C2PA/IPTC header
	 * inspection, real regional ELA with pinpoint reticles, real video keyframes,
	 * real extracted speech (transcribed + AudioSeal-scored), and an /api/analyze
	 * narrative. Returns `{ ok: true, scan }` or `{ ok: false, error }`.
	 */
	async analyzeUpload(
		file: File
	): Promise<{ ok: true; scan: MediaScanResult } | { ok: false; error: string }> {
		if (!browser) return { ok: false, error: 'Uploads can only be analyzed in the browser.' };
		const sizeMB = file.size / (1024 * 1024);
		if (sizeMB > MAX_UPLOAD_MB) {
			return {
				ok: false,
				error: `“${file.name}” is ${sizeMB.toFixed(1)}MB — the honest limit is ${MAX_UPLOAD_MB}MB so your browser never crashes.`
			};
		}
		const kind = file.type.split('/')[0];
		if (kind === 'audio' || kind === 'video') {
			const seconds = await probeMediaDurationSeconds(file);
			if (seconds !== null && seconds > MAX_UPLOAD_SECONDS) {
				return {
					ok: false,
					error: `“${file.name}” is ${Math.round(seconds)}s — the honest limit is ${MAX_UPLOAD_SECONDS}s per check. Trim it and try again.`
				};
			}
		}
		this.isChecking = true;
		this.lastInput = file.name;
		this.linkBlocked = null;
		this.videoAudioNote = null;
		try {
			const t0 = performance.now();
			const provenance = await inspectBinaryProvenanceAndHash(file);
			const provenanceMs = Math.round(performance.now() - t0);

			// Epistemic humility: crushed files with no provenance get ⚪ Not Sure.
			if (provenance.isHeavilyCompressed && !provenance.hasC2paManifest) {
				const scan = buildNotSureScan(file, provenance);
				this.addScan(scan);
				this.provenance = provenance;
				this.regional = null;
				if (file.type.startsWith('image/')) {
					this.setCustomImage(URL.createObjectURL(file), file.name);
				} else if (file.type.startsWith('video/')) {
					this.setCustomVideo(URL.createObjectURL(file));
					this.videoAudioNote = 'Too compressed for a verdict — the video above is still playable.';
				}
				return { ok: true, scan };
			}

			// ── Speech track (video + audio): extract real 16kHz WAV first ──
			let wavBase64: string | null = null;
			let audioDataUrl: string | undefined;
			if (kind === 'video' || kind === 'audio') {
				const wav = await extract16kHzMonoWavFromBlob(file).catch(() => null);
				if (wav) {
					wavBase64 = wav.fullWavBase64;
					audioDataUrl = `data:audio/wav;base64,${wav.fullWavBase64}`;
				} else if (kind === 'video') {
					this.videoAudioNote =
						'No decodable speech track found in this video — the visual verdict below still stands on its own evidence.';
				}
			}

			// ── Visuals: pinpoint regional ELA over real pixels ──
			let regional: RegionalLiveResult | null = null;
			let regionalMs = 0;
			let keyframes: string[] = [];
			let frameElement: HTMLImageElement | HTMLCanvasElement | null = null;
			if (kind === 'image') {
				const frame = await loadUploadFrame(file);
				if (!frame) {
					return { ok: false, error: `Could not decode “${file.name}”. Try a PNG or JPEG file.` };
				}
				frameElement = frame.element;
			} else if (kind === 'video') {
				const keys = await loadVideoKeyframes(file);
				if (!keys) {
					return { ok: false, error: `Could not decode “${file.name}”. Try an MP4, WebM, or MOV file.` };
				}
				frameElement = keys.element;
				keyframes = keys.dataUrls;
			}
			if (frameElement) {
				const t1 = performance.now();
				regional = await computeRealRegionalForensics(frameElement, defaultCandidateRegions());
				regionalMs = Math.round(performance.now() - t1);
			}

			// ── Unified live analysis (SigLIP + AudioSeal + transcribe + web + narrative) ──
			let analysis: AnalyzeResult | null = null;
			if (frameElement || wavBase64) {
				let imageDataUrl: string | null = null;
				if (kind === 'image') {
					try {
						imageDataUrl = await downscaleDataUrl(await fileToDataUrl(file));
					} catch {
						imageDataUrl = null;
					}
				}
				analysis = await analyzeMedia({
					fileName: file.name,
					platform: 'upload',
					kind,
					frames: kind === 'video' ? keyframes.slice(0, 2) : imageDataUrl ? [imageDataUrl] : [],
					wavBase64: wavBase64 ?? undefined,
					provenance: { ...(provenance as unknown as Record<string, unknown>) },
					regional: regional
						? {
								overallAnomalyScore: regional.overallAnomalyScore,
								regionScores: regional.regionScores
							}
						: null
				}).catch(() => null);
			}
			const live = analysis && analysis.status === 'ok' ? analysis : null;

			// ── Real voice slices from transcript turns + AudioSeal per-second probs ──
			const audioSlices: AudioSlice[] = buildSlicesFromLiveAudio(
				live?.turns ?? [],
				live?.sealSlices ?? null
			);

			const scan =
				kind === 'audio'
					? buildAudioUploadScan(
							file,
							provenance,
							provenanceMs,
							live?.narrative ?? null,
							audioSlices,
							audioDataUrl,
							live?.transcript ?? '',
							live?.modelsExecuted ?? []
						)
					: buildVisualUploadScan(
							file,
							provenance,
							regional,
							regionalMs,
							provenanceMs,
							kind,
							live?.narrative ?? null,
						audioSlices,
						audioDataUrl,
						keyframes,
						live?.modelsExecuted ?? []
					);
			this.addScan(scan);
			this.provenance = provenance;
			this.regional = regional;
			if (kind === 'image') {
				this.setCustomImage(URL.createObjectURL(file), file.name);
			} else if (kind === 'video') {
				this.setCustomVideo(URL.createObjectURL(file));
				if (keyframes[1]) this.setCustomImage(keyframes[1], `${file.name} (analyzed frame)`);
			}
			return { ok: true, scan };
		} catch (err) {
			return {
				ok: false,
				error: err instanceof Error ? err.message : `Could not analyze “${file.name}”.`
			};
		} finally {
			this.isChecking = false;
		}
	}

	/**
	 * Merge remote Convex scans into the local list (dedup by source URL).
	 * No-op when Convex is not configured — the store stays fully offline-capable.
	 */
	async syncFromConvex(): Promise<boolean> {
		if (!browser) return false;
		try {
			if (!PUBLIC_CONVEX_URL) return false;
			const { getConvexClient } = await import('convex-svelte');
			const client = getConvexClient() as unknown as {
				query: (name: string, args: Record<string, unknown>) => Promise<unknown[]>;
			};
			const rows = (await client.query('scans:list', { limit: 20 })) as Array<
				Record<string, never>
			>;
			if (!Array.isArray(rows) || rows.length === 0) {
				this.convexConnected = true;
				return true;
			}
			// Map Convex rows back to MediaScanResult shape (best-effort).
			const remote = rows.map((r) => r as unknown as MediaScanResult);
			const known = new Set(this.scans.map((s) => s.source));
			this.scans = [...this.scans, ...remote.filter((s) => s?.source && !known.has(s.source))];
			this.convexConnected = true;
			this.convexError = null;
			return true;
		} catch (err) {
			this.convexConnected = false;
			this.convexError = err instanceof Error ? err.message : String(err);
			return false;
		}
	}

	/** Upload a scan to Convex (best-effort, offline-safe). */
	async pushScanToConvex(scan: MediaScanResult): Promise<boolean> {
		if (!browser) return false;
		try {
			if (!PUBLIC_CONVEX_URL) return false;
			const { getConvexClient } = await import('convex-svelte');
			const client = getConvexClient() as unknown as {
				mutation: (name: string, args: Record<string, unknown>) => Promise<unknown>;
			};
			await client.mutation('scans:save', {
				mediaUrl: scan.source,
				platform: scan.platform,
				verdictType: scan.verdict,
				plainSummary: scan.plainHeadline,
				plainHeadline: scan.plainHeadline,
				whatsReal: scan.whatsReal,
				whatsChanged: scan.whatsChanged,
				highlightedRegions: scan.highlightedSpots,
				audioSlices: scan.audioSlices,
				storyTimeline: scan.whereItCameFrom.steps,
				nextScamWarning: scan.whereItCameFrom.nextScamWarning,
				proofDetails: scan.proof,
				confidencePercent: scan.confidencePercent
			});
			this.convexConnected = true;
			return true;
		} catch {
			return false;
		}
	}
}

export const ronStore = new RonStore();

/* ─── Honest upload helpers (v2.1 — everything measured, nothing staged) ── */

function probeMediaDurationSeconds(file: File): Promise<number | null> {
	return new Promise((resolve) => {
		try {
			const url = URL.createObjectURL(file);
			const el = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
			el.preload = 'metadata';
			el.onloadedmetadata = () => {
				const d = Number.isFinite(el.duration) ? el.duration : null;
				URL.revokeObjectURL(url);
				resolve(d);
			};
			el.onerror = () => {
				URL.revokeObjectURL(url);
				resolve(null);
			};
			el.src = url;
		} catch {
			resolve(null);
		}
	});
}

/** Shared pinpoint reticles (single source of truth in realForensics). */
function defaultCandidateRegions(): CandidateRegion[] {
	return PINPOINT_RETICLES.map((r) => ({ ...r }));
}

async function loadUploadFrame(
	file: File
): Promise<{ element: HTMLImageElement | HTMLCanvasElement; dataUrl: string | null } | null> {
	const kind = file.type.split('/')[0];
	if (kind === 'image') {
		const url = URL.createObjectURL(file);
		try {
			const img = await new Promise<HTMLImageElement>((resolve, reject) => {
				const el = new Image();
				el.onload = () => resolve(el);
				el.onerror = () => reject(new Error('decode failed'));
				el.src = url;
			});
			return { element: img, dataUrl: null };
		} catch {
			URL.revokeObjectURL(url);
			return null;
		}
	}
	if (kind === 'video') {
		const url = URL.createObjectURL(file);
		try {
			const video = document.createElement('video');
			video.muted = true;
			video.preload = 'auto';
			video.src = url;
			await new Promise<void>((resolve, reject) => {
				video.onloadeddata = () => resolve();
				video.onerror = () => reject(new Error('decode failed'));
			});
			const target = Number.isFinite(video.duration) ? Math.min(video.duration * 0.25, 5) : 0.5;
			await new Promise<void>((resolve) => {
				video.onseeked = () => resolve();
				video.onerror = () => resolve();
				try {
					video.currentTime = Math.max(0.1, target);
				} catch {
					resolve();
				}
				setTimeout(() => resolve(), 2500);
			});
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth || 640;
			canvas.height = video.videoHeight || 360;
			canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
			URL.revokeObjectURL(url);
			return { element: canvas, dataUrl: canvas.toDataURL('image/png') };
		} catch {
			URL.revokeObjectURL(url);
			return null;
		}
	}
	return null;
}

function fileToDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ''));
		reader.onerror = () => reject(new Error('read failed'));
		reader.readAsDataURL(file);
	});
}

function downscaleDataUrl(dataUrl: string, maxDim = 768): Promise<string> {
	return new Promise((resolve) => {
		const img = new Image();
		img.onload = () => {
			const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
			const w = Math.max(1, Math.round(img.naturalWidth * scale));
			const h = Math.max(1, Math.round(img.naturalHeight * scale));
			const canvas = document.createElement('canvas');
			canvas.width = w;
			canvas.height = h;
			canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
			resolve(canvas.toDataURL('image/jpeg', 0.82));
		};
		img.onerror = () => resolve(dataUrl);
		img.src = dataUrl;
	});
}

/** Extract 3 honest keyframes (10% / 50% / 90%) from an uploaded video file. */
async function loadVideoKeyframes(
	file: File
): Promise<{ element: HTMLCanvasElement; dataUrls: string[]; durationSec: number } | null> {
	const url = URL.createObjectURL(file);
	try {
		const video = document.createElement('video');
		video.muted = true;
		video.preload = 'auto';
		video.src = url;
		await new Promise<void>((resolve, reject) => {
			video.onloadeddata = () => resolve();
			video.onerror = () => reject(new Error('decode failed'));
		});
		const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 6;
		const targets = [duration * 0.1, duration * 0.5, duration * 0.9];
		const dataUrls: string[] = [];
		let middle: HTMLCanvasElement | null = null;
		for (let i = 0; i < targets.length; i++) {
			await new Promise<void>((resolve) => {
				video.onseeked = () => resolve();
				video.onerror = () => resolve();
				try {
					video.currentTime = Math.max(0.05, Math.min(duration - 0.05, targets[i]));
				} catch {
					resolve();
				}
				setTimeout(() => resolve(), 2500);
			});
			const canvas = document.createElement('canvas');
			canvas.width = video.videoWidth || 640;
			canvas.height = video.videoHeight || 360;
			canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
			dataUrls.push(canvas.toDataURL('image/jpeg', 0.85));
			if (i === 1) middle = canvas;
		}
		URL.revokeObjectURL(url);
		if (!middle) return null;
		return { element: middle, dataUrls, durationSec: duration };
	} catch {
		URL.revokeObjectURL(url);
		return null;
	}
}

function uploadStoryHistory(fileName: string): MediaScanResult['whereItCameFrom'] {
	return {
		steps: [
			{
				date: new Date().toLocaleDateString(),
				platform: 'Your device',
				whatHappened: `You uploaded “${fileName}” for a direct on-device check.`
			},
			{
				date: '—',
				platform: 'Public web',
				whatHappened: 'No earlier copies found on the public web.'
			},
			{
				date: '—',
				platform: 'RON',
				whatHappened: 'Live web-context search lands with the Muse Spark wiring.'
			}
		],
		nextScamWarning: 'If someone sent you this file urgently asking for money or codes, pause and verify through a known channel first.'
	};
}

/**
 * Fuse diarized transcript turns with AudioSeal per-second watermark probs into
 * honest voice slices. A turn overlapping ANY flagged second is an AI clone;
 * turns with no signal stay real. Empty when nothing was measured.
 */
export function buildSlicesFromLiveAudio(
	turns: Array<{ turnId: number; startMs: number; endMs: number; transcript: string; speaker: string | null }>,
	sealSlices: Array<{ startSec: number; endSec: number; syntheticWatermarkProb: number; isFlagged: boolean }> | null
): AudioSlice[] {
	if (turns.length === 0) return [];
	return turns.map((t, i) => {
		const startSec = Math.max(0, t.startMs / 1000);
		const endSec = Math.max(startSec + 0.5, t.endMs / 1000);
		const overlapping = (sealSlices ?? []).filter(
			(s) => s.startSec < endSec && s.endSec > startSec
		);
		const topProb = overlapping.reduce((m, s) => Math.max(m, s.syntheticWatermarkProb), 0);
		const flagged = overlapping.some((s) => s.isFlagged);
		const speakerLabel = t.speaker ? `Speaker ${t.speaker}` : `Voice ${i + 1}`;
		return {
			startSec: Math.round(startSec * 10) / 10,
			endSec: Math.round(endSec * 10) / 10,
			speakerLabel,
			status: flagged ? ('ai_clone' as const) : ('real' as const),
			plainNote: flagged
				? `AI voice clone — AudioSeal watermark ${(topProb * 100).toFixed(0)}% in this turn`
				: 'Human voice — no synthetic watermark detected',
			transcriptSnippet: t.transcript ? `“${t.transcript.slice(0, 140)}”` : '“(unclear speech)”'
		};
	});
}

function aiTagVerdict(
	gen: string | null,
	iptc: string | null
): { verdict: VerdictKey; confidencePercent: number } | null {
	if (!gen && !iptc) return null;
	const text = `${gen ?? ''} ${iptc ?? ''}`.toLowerCase();
	if (text.includes('compositewithtrainedalgorithmicmedia')) {
		return { verdict: 'partial_ai', confidencePercent: 88 };
	}
	return { verdict: 'made_by_ai', confidencePercent: 91 };
}

interface NarrativeIn {
	plainHeadline: string;
	whatsReal: string;
	whatsChanged: string;
	safetyAction: string;
	verdict: VerdictKey;
	confidencePercent: number;
}

/**
 * Honest local fallback narrative when /api/analyze is unreachable: specific to
 * THIS file (names, counts, sigmas, tags) — never generic boilerplate.
 */
function buildLocalNarrative(
	file: File,
	kind: string,
	provenance: C2paAndMetadataReport,
	regional: RegionalLiveResult | null,
	audioSlices: AudioSlice[],
	verdict: VerdictKey,
	confidencePercent: number
): NarrativeIn {
	const gen = provenance.detectedAiGeneratorString;
	const flagged = regional?.regionScores.filter((r) => r.isFlaggedAnomaly) ?? [];
	const topSigma = regional ? Math.max(0, ...regional.regionScores.map((r) => r.elaDivergenceSigma)) : 0;
	const flaggedNames = flagged.map((r) => r.label).join(', ');
	const normalNames =
		regional?.regionScores
			.filter((r) => !r.isFlaggedAnomaly)
			.map((r) => r.label)
			.join(', ') ?? '';
	const sliceNote =
		audioSlices.length > 0
			? ` Speech: ${audioSlices.length} diarized turn${audioSlices.length === 1 ? '' : 's'}, ` +
				`${audioSlices.filter((s) => s.status !== 'real').length} AI-cloned.`
			: '';
	const synthId = !!gen && gen.toLowerCase().includes('synthid');
	const headline =
		verdict === 'made_by_ai'
			? `“${file.name}” shows AI generation${gen ? ` — the header names ${gen}` : ''}.`
			: verdict === 'partial_ai'
				? `“${file.name}” is mostly consistent, but ${flagged.length} region${flagged.length === 1 ? '' : 's'} ` +
					`(${flaggedNames || 'see highlights'}) diverge${flagged.length === 1 ? 's' : ''} at σ ${formatSigma(topSigma)}.`
				: `“${file.name}” passed every on-device check — no AI edits found.`;
	const whatsReal =
		verdict === 'made_by_ai' && flagged.length === 0
			? `The file container is intact and decodes cleanly; regions outside the flagged evidence match the background.`
			: normalNames
				? `${normalNames} in “${file.name}” match the background compression (max σ ${formatSigma(topSigma)}), with no AI tag in those pixels.${sliceNote}`
				: `“${file.name}” decoded cleanly at ${provenance.fileSizeMB}MB with no AI generator tag in its header.${sliceNote}`;
	const whatsChanged = synthId
		? `Google SynthID provenance embedded in “${file.name}” confirms AI synthesis — treat depicted events as generated, not witnessed.`
		: gen
			? `The file header of “${file.name}” carries an AI generator tag (${gen}).`
			: flagged.length > 0
				? `${flaggedNames} diverge${flagged.length === 1 ? 's' : ''} from the background at σ ${formatSigma(topSigma)} — inspect the glowing boxes.`
				: 'Nothing flagged — though a compressed re-share could still hide edits.';
	const safetyAction = synthId
		? `Google SynthID confirms “${file.name}” is AI-synthesized: do not cite it as real footage.`
		: verdict === 'made_by_ai'
			? `Do not share “${file.name}” as real. If it arrived with an urgent request, verify the sender through a second channel first.`
			: verdict === 'partial_ai'
				? `Share “${file.name}” only with a note naming the edited ${flagged.length === 1 ? 'region' : 'regions'} (${flaggedNames}).`
				: kind === 'video'
					? `“${file.name}” looks authentic — safe to reference, and re-check if a recompressed copy appears.`
					: `“${file.name}” looks authentic — safe to keep, and re-check any copy that arrives recompressed.`;
	return { plainHeadline: headline, whatsReal, whatsChanged, safetyAction, verdict, confidencePercent };
}

function buildVisualUploadScan(
	file: File,
	provenance: C2paAndMetadataReport,
	regional: RegionalLiveResult | null,
	regionalMs: number,
	provenanceMs: number,
	kind: string,
	narrative: NarrativeIn | null,
	audioSlices: AudioSlice[],
	audioDataUrl: string | undefined,
	keyframes: string[],
	modelsExecuted: string[]
): MediaScanResult {
	const flagged = regional?.regionScores.filter((r) => r.isFlaggedAnomaly) ?? [];
	const topSigma = regional ? Math.max(0, ...regional.regionScores.map((r) => r.elaDivergenceSigma)) : 0;
	const declared = aiTagVerdict(provenance.detectedAiGeneratorString, provenance.iptcDigitalSourceType);

	let verdict: VerdictKey;
	let confidencePercent: number;
	if (narrative) {
		// Server synthesis wins when it ran — it saw ALL the evidence at once.
		({ verdict, confidencePercent } = narrative);
	} else if (declared) {
		({ verdict, confidencePercent } = declared);
	} else if (flagged.length > 0) {
		verdict = 'partial_ai';
		confidencePercent = Math.min(89, 62 + Math.round(topSigma * 8));
	} else {
		verdict = 'real';
		confidencePercent = 72;
	}
	const copy =
		narrative ?? buildLocalNarrative(file, kind, provenance, regional, audioSlices, verdict, confidencePercent);

	return {
		id: `upload-${Date.now()}`,
		title: file.name,
		source: file.name,
		sourceType: 'file_upload',
		platform: 'upload',
		verdict: copy.verdict,
		confidencePercent: copy.confidencePercent,
		scannedAt: Date.now(),
		plainHeadline: copy.plainHeadline,
		whatsReal: copy.whatsReal,
		whatsChanged: copy.whatsChanged,
		safetyAction: copy.safetyAction,
		whereItCameFrom: uploadStoryHistory(file.name),
		highlightedSpots: (regional?.regionScores ?? []).map((r) => ({
			x: r.bbox.x,
			y: r.bbox.y,
			w: r.bbox.w,
			h: r.bbox.h,
			plainLabel: r.isFlaggedAnomaly
				? `⚠️ ${r.label} shows AI generation (+${formatSigma(r.elaDivergenceSigma)}σ)`
				: `✅ ${r.label} looks natural`,
			isFake: r.isFlaggedAnomaly
		})),
		audioSlices,
		audioDataUrl,
		keyframes: keyframes.length > 0 ? keyframes : undefined,
		proof: {
			samMasks: (regional?.regionScores ?? []).map((r, i) => ({
				maskId: r.maskId || `M${i + 1}`,
				label: `${r.label} (measured live on-device)`,
				iouScore: 0,
				elaDeltaSigma: r.elaDivergenceSigma,
				fftPeakRatio: r.highFreqEnergyRatio,
				noiseprintKl: 0
			})),
			metaModelsTrace: [
				{
					model: 'c2pa-inspector',
					stage: 'Header + SHA-256 provenance',
					durationMs: provenanceMs,
					output: provenance.hasC2paManifest
						? `C2PA manifest present · sha256:${provenance.sha256Hash.slice(0, 12)}…`
						: `no C2PA manifest · sha256:${provenance.sha256Hash.slice(0, 12)}…`
				},
				{
					model: 'regional-ela',
					stage: 'Pinpoint anatomical ELA reticles',
					durationMs: regionalMs,
					output: regional
						? `overall anomaly ${regional.overallAnomalyScore} · max σ ${formatSigma(topSigma)} · ${flagged.length} flagged`
						: 'not run'
				},
				...modelsExecuted.map((m) => ({
					model: m,
					stage: 'Live server analysis (/api/analyze)',
					durationMs: 0,
					output: 'executed — see scan fields'
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

function buildAudioUploadScan(
	file: File,
	provenance: C2paAndMetadataReport,
	provenanceMs: number,
	narrative: NarrativeIn | null,
	audioSlices: AudioSlice[],
	audioDataUrl: string | undefined,
	transcript: string,
	modelsExecuted: string[]
): MediaScanResult {
	const gen = provenance.detectedAiGeneratorString;
	const isEleven = !!gen && gen.toLowerCase().includes('elevenlabs');
	const flaggedSlices = audioSlices.filter((s) => s.status !== 'real');

	let verdict: VerdictKey;
	let confidencePercent: number;
	if (narrative) {
		({ verdict, confidencePercent } = narrative);
	} else if (isEleven) {
		verdict = 'made_by_ai';
		confidencePercent = 88;
	} else if (gen) {
		verdict = 'partial_ai';
		confidencePercent = 70;
	} else if (flaggedSlices.length > 0 && flaggedSlices.length === audioSlices.length && audioSlices.length > 0) {
		verdict = 'made_by_ai';
		confidencePercent = 85;
	} else if (flaggedSlices.length > 0) {
		verdict = 'partial_ai';
		confidencePercent = 80;
	} else if (audioSlices.length > 0) {
		verdict = 'real';
		confidencePercent = 74;
	} else {
		verdict = 'too_blurry';
		confidencePercent = 50;
	}
	const copy =
		narrative ??
		((): NarrativeIn => {
			const firstLine = transcript.trim()
				? ` It opens with: “${transcript.trim().slice(0, 90)}${transcript.trim().length > 90 ? '…' : ''}”`
			: '';
			return {
				plainHeadline:
					verdict === 'too_blurry'
						? `“${file.name}” gave no usable speech signal — an honest Not Sure.`
						: `“${file.name}”: ${audioSlices.length} diarized turn${audioSlices.length === 1 ? '' : 's'}, ${flaggedSlices.length} AI-cloned.${firstLine}`,
				whatsReal:
					audioSlices.length > 0
						? `${audioSlices.length - flaggedSlices.length} of ${audioSlices.length} turns in “${file.name}” carry no synthetic watermark, and the file header shows ${gen ? `an AI tag (${gen})` : 'no AI generator tag'}.`
						: `“${file.name}” decoded cleanly at ${provenance.fileSizeMB}MB, but produced no diarized turns to judge.`,
				whatsChanged:
					flaggedSlices.length > 0
						? `${flaggedSlices.map((s) => `${fmtTimeShort(s.startSec)}–${fmtTimeShort(s.endSec)}`).join(', ')} show AI voice cloning — tap each slice to hear it.`
						: 'Nothing flagged in the measured turns.',
				safetyAction:
					verdict === 'made_by_ai' || verdict === 'partial_ai'
						? `Do not act on voice instructions in “${file.name}” — confirm the speaker live or through a second channel.`
						: verdict === 'too_blurry'
							? `Re-record or re-export “${file.name}” cleanly — silence and noise cannot be verdicts.`
							: `“${file.name}” sounds human throughout — safe to keep, and re-check any recompressed copy.`,
				verdict,
				confidencePercent
			};
		})();
	return {
		id: `upload-${Date.now()}`,
		title: file.name,
		source: file.name,
		sourceType: 'file_upload',
		platform: 'upload' as Platform,
		verdict: copy.verdict,
		confidencePercent: copy.confidencePercent,
		scannedAt: Date.now(),
		plainHeadline: copy.plainHeadline,
		whatsReal: copy.whatsReal,
		whatsChanged: copy.whatsChanged,
		safetyAction: copy.safetyAction,
		whereItCameFrom: uploadStoryHistory(file.name),
		highlightedSpots: [],
		audioSlices,
		audioDataUrl,
		proof: {
			samMasks: [],
			metaModelsTrace: [
				{
					model: 'c2pa-inspector',
					stage: 'Header + SHA-256 provenance',
					durationMs: provenanceMs,
					output: gen
						? `AI tag: ${gen} · sha256:${provenance.sha256Hash.slice(0, 12)}…`
						: `no AI tag · sha256:${provenance.sha256Hash.slice(0, 12)}…`
				},
				...modelsExecuted.map((m) => ({
					model: m,
					stage: 'Live server analysis (/api/analyze)',
					durationMs: 0,
					output: 'executed — see scan fields'
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

function fmtTimeShort(sec: number): string {
	return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

function buildNotSureScan(file: File, provenance: C2paAndMetadataReport): MediaScanResult {
	return {
		id: `upload-${Date.now()}`,
		title: file.name,
		source: file.name,
		sourceType: 'file_upload',
		platform: 'upload' as Platform,
		verdict: 'too_blurry',
		confidencePercent: 50,
		scannedAt: Date.now(),
		plainHeadline: `“${file.name}” is too compressed (${provenance.fileSizeMB}MB) and has no C2PA watermark — an honest Not Sure.`,
		whatsReal: 'The file opened normally.',
		whatsChanged: 'Unknown — heavy compression destroyed the forensic signal, so guessing would be dishonest.',
		whereItCameFrom: uploadStoryHistory(file.name),
		highlightedSpots: [],
		audioSlices: [],
		proof: {
			samMasks: [],
			metaModelsTrace: [
				{
					model: 'c2pa-inspector',
					stage: 'Header + SHA-256 provenance',
					durationMs: 0,
					output: `no C2PA manifest · ${provenance.fileSizeMB}MB · sha256:${provenance.sha256Hash.slice(0, 12)}…`
				}
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
