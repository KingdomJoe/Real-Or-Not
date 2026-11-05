<script lang="ts">
	import VerdictBadge from '#lib/components/VerdictBadge.svelte';
	import { ronStore } from '#lib/stores/ronStore.svelte';
		import {
		LOUPE_LAYERS,
		PLATFORM_LABEL,
		SAFETY_ACTION,
		TRUST_AS_IS,
		VERDICT_META,
		formatSigma,
		truncateWords,
		type AudioSliceStatus,
		type LoupeLayer
	} from '#lib/types/ron';
	import { computeRealRegionalForensics, type RegionalMaskScore } from '#lib/services/realForensics';
	import {
		checkWebContext,
		sparkOpenReason,
		type WebSource
	} from '#lib/services/metaApi';
	import { analyzeImageData } from '#lib/workers/forensics-client';
	import { browser } from '$app/env';
	import {
		AudioLines,
		ChevronDown,
		CircleDot,
		Cpu,
		Crosshair,
		Download,
		Eye,
		EyeOff,
		FlaskConical,
		Loader2,
		MapPin,
		Pause,
		Play,
		Receipt,
		ScanSearch,
		ShieldCheck
	} from '@lucide/svelte';
	import { untrack } from 'svelte';
	import { Spring, Tween } from 'svelte/motion';
	import { slide } from 'svelte/transition';
	import { toast } from 'svelte-sonner';

	/* ─── Derived scan state ─────────────────────────────────────────────── */
	const scan = $derived(ronStore.activeScan);
	const meta = $derived(VERDICT_META[scan.verdict]);
	const baseTrust = $derived(TRUST_AS_IS[scan.verdict] ?? 50);
	const hasAudio = $derived(scan.audioSlices.length > 0);
	const hasSpots = $derived(scan.highlightedSpots.length > 0);
	const maxEnd = $derived(
		hasAudio ? Math.max(...scan.audioSlices.map((s) => s.endSec)) : 1
	);

	const STATUS_META: Record<AudioSliceStatus, { label: string; color: string }> = {
		real: { label: 'Real human voice', color: '#10B981' },
		ai_clone: { label: 'AI voice clone', color: '#EF4444' },
		scam_script: { label: 'Scam script', color: '#8B5CF6' }
	};

	function fmtTime(sec: number): string {
		return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
	}

	/* ─── Meter 1 authenticity (Tweened toward the scan baseline) ──────────── */
	const trust = new Tween(TRUST_AS_IS[ronStore.activeScan.verdict] ?? 50, { duration: 900 });
	const trustShown = $derived(Math.round(trust.current));
	const trustColor = $derived(trustShown >= 80 ? '#10B981' : trustShown >= 40 ? '#F59E0B' : meta.color);

	/* Live regional ELA measured from the actual displayed pixels (never hardcoded). */
	let liveRegional = $state<{
		overallAnomalyScore: number;
		elaDataUrl: string;
		regionScores: RegionalMaskScore[];
	} | null>(null);
	let liveRegionalNote = $state('');
	let liveRegionalRun = 0;
	let liveRegionalKey = '';

	/* ─── Audio slicer state ─────────────────────────────────────────────── */
	let selectedSlice = $state(0);
	let playing = $state(false);
	let playhead = $state(0);
	const selected = $derived(scan.audioSlices[selectedSlice] ?? null);
	/** Real media element when the scan ships audio bytes; otherwise simulated. */
	let audioEl: HTMLAudioElement | null = $state(null);
	let playStopAt: number | null = null;
	const hasRealAudio = $derived(!!scan.audioDataUrl);
	const activeSliceIdx = $derived.by(() => {
		const i = scan.audioSlices.findIndex((s) => playhead >= s.startSec && playhead < s.endSec);
		return i >= 0 ? i : selectedSlice;
	});

	/** Deterministic pseudo-waveform bar height (seeded — no render flicker). */
	function barHeight(sliceIdx: number, barIdx: number): number {
		const x = Math.sin(sliceIdx * 311.7 + barIdx * 127.1) * 43758.5453;
		return 28 + (x - Math.floor(x)) * 72;
	}

	function barsForSlice(idx: number): number {
		const s = scan.audioSlices[idx];
		if (!s) return 8;
		return Math.min(44, Math.max(8, Math.round((s.endSec - s.startSec) * 9)));
	}

	/* ─── Canvas refs + offscreen buffers (browser only) ────────────────── */
	const FW = 640;
	const FH = 360;
	let frameCanvas: HTMLCanvasElement | null = $state(null);
	let loupeCanvas: HTMLCanvasElement | null = $state(null);
	let stageBox: HTMLDivElement | null = $state(null);
	let rawCanvas: HTMLCanvasElement | null = null;
	let layerCanvas: HTMLCanvasElement | null = null;
	let customImg: HTMLImageElement | null = null;
	let frameVersion = $state(0);

	/* ─── X-Ray Loupe state ──────────────────────────────────────────────── */
	let loupeLayer = $state<LoupeLayer>('ela');
	let elaSens = $state(90);
	let fftCut = $state(0.4);
	let ditherDensity = $state(0.5);
	let draggingLoupe = $state(false);
	let analyzing = $state(false);
	let engineName = $state<string>('…');
	let lastMs = $state(0);
	const loupeX = new Spring(FW * 0.62, { stiffness: 0.18, damping: 0.72 });
	const loupeY = new Spring(FH * 0.44, { stiffness: 0.18, damping: 0.72 });
	const LOUPE_PX = 220;
	let lastOverlay: {
		ela: Uint8ClampedArray;
		fft: Uint8ClampedArray;
		width: number;
		height: number;
		raw: ImageData;
	} | null = null;
	let forensicsRunId = 0;
	let forensicsTimer: ReturnType<typeof setTimeout> | null = null;

	/* ─── Live AI checks (Check B web grounding + Spark Open opinion) ──────── */
	// Flat state (no nested unions): Svelte template narrowing is unreliable
	// across {#if} chains, and these values render in several places.
	type CheckPhase = 'idle' | 'loading' | 'done' | 'error';
	let webPhase = $state<CheckPhase>('idle');
	let webSources = $state<WebSource[]>([]);
	let webSummary = $state('');
	let webBriefing = $state<{ origin: string; evolution: string; impact: string }>({
		origin: '',
		evolution: '',
		impact: ''
	});
	let webSearched = $state(false);
	let webModel = $state('');
	let webError = $state('');
	let sparkPhase = $state<CheckPhase>('idle');
	let sparkText = $state('');
	let sparkModel = $state('');
	let sparkError = $state('');

	function hostOf(url: string): string {
		try {
			return new URL(url).hostname.replace(/^www\./, '');
		} catch {
			return url;
		}
	}

	function resetLiveChecks() {
		webPhase = 'idle';
		webSources = [];
		webSummary = '';
		webBriefing = { origin: '', evolution: '', impact: '' };
		webSearched = false;
		webModel = '';
		webError = '';
		sparkPhase = 'idle';
		sparkText = '';
		sparkModel = '';
		sparkError = '';
	}

	async function runWebCheck() {
		if (!browser) return;
		webPhase = 'loading';
		webError = '';
		try {
			const result = await checkWebContext(scan.plainHeadline, {
				title: scan.title,
				platform: scan.platform
			});
			if (result.status === 'ok') {
				webSources = result.sources;
				webSummary = result.summary;
				webBriefing = result.briefing;
				webSearched = result.searched;
				webModel = result.model;
				webPhase = 'done';
			} else {
				webError = result.message;
				webPhase = 'error';
			}
		} catch (err) {
			webError = err instanceof Error ? err.message : 'Web check failed.';
			webPhase = 'error';
		}
	}

	function buildOpinionPrompt(): string {
		const lines = [
			`Media: ${scan.title} (${scan.platform}, ${scan.sourceType}).`,
			`On-device verdict: ${meta.label} (${scan.confidencePercent}% sure).`,
			`Summary: ${scan.plainHeadline}`,
			`What's real: ${scan.whatsReal}`,
			`What changed: ${scan.whatsChanged}`
		];
		if (ronStore.provenance) {
			const p = ronStore.provenance;
			lines.push(
				`Provenance (measured): C2PA ${p.hasC2paManifest ? 'present' : 'absent'}, ` +
					`IPTC ${p.iptcDigitalSourceType ?? 'not declared'}, ` +
					`AI tag ${p.detectedAiGeneratorString ?? 'none'}, ` +
					`${p.fileSizeMB}MB, sha256 ${p.sha256Hash.slice(0, 16)}….`
			);
		}
		const regional = liveRegional ?? ronStore.regional;
		if (regional) {
			const top = Math.max(0, ...regional.regionScores.map((r) => r.elaDivergenceSigma));
			lines.push(
				`Regional ELA (measured): overall anomaly ${regional.overallAnomalyScore}/100, ` +
					`max σ ${top.toFixed(2)}, ` +
					`${regional.regionScores.filter((r) => r.isFlaggedAnomaly).length} of ${regional.regionScores.length} regions flagged.`
			);
		} else {
			lines.push('Regional ELA: still measuring — assess from the summary above.');
		}
		lines.push(
			'In plain, friendly English (max 120 words): agree or push back on the verdict, ' +
				'name the single strongest reason, and say what would change your mind.'
		);
		return lines.join('\n');
	}

	async function runSparkOpinion() {
		if (!browser) return;
		sparkPhase = 'loading';
		sparkError = '';
		try {
			// 1000 tokens: the 816B model reasons first (~600) even on low effort,
			// then answers — verified live that smaller budgets truncate the text.
			const result = await sparkOpenReason(buildOpinionPrompt(), { maxTokens: 1000 });
			if (result.status === 'ok') {
				sparkText = result.text;
				sparkModel = result.model;
				sparkPhase = 'done';
			} else {
				sparkError = result.message;
				sparkPhase = 'error';
			}
		} catch (err) {
			sparkError = err instanceof Error ? err.message : 'Request failed.';
			sparkPhase = 'error';
		}
	}

	/* ─── Scan-change resets ────────────────────────────────────────────── */
	$effect(() => {
		void scan.id;
		selectedSlice = 0;
		playing = false;
		playhead = 0;
		playStopAt = null;
		audioEl?.pause();
		liveRegional = null;
		liveRegionalNote = '';
		resetLiveChecks();
		trust.set(TRUST_AS_IS[scan.verdict] ?? 50, { duration: 0 });
		loupeX.target = FW * 0.62;
		loupeY.target = FH * 0.44;
		lastOverlay = null;
	});

	$effect(() => {
		trust.target = baseTrust;
	});

	function pauseAll() {
		playing = false;
		playStopAt = null;
		try {
			audioEl?.pause();
		} catch {
			/* noop */
		}
	}

	async function startPlayback(start: number, stopAt: number | null) {
		playStopAt = stopAt;
		if (browser && scan.audioDataUrl && audioEl) {
			try {
				if (audioEl.getAttribute('src') !== scan.audioDataUrl) audioEl.src = scan.audioDataUrl;
				audioEl.currentTime = Math.max(0, Math.min(start, Math.max(0, maxEnd - 0.05)));
				await audioEl.play();
				playing = true;
				return;
			} catch {
				/* fall through to simulated clock */
			}
		}
		playhead = start;
		playing = true;
	}

	function toggleTimeline() {
		if (playing) {
			pauseAll();
			return;
		}
		void startPlayback(playhead >= maxEnd - 0.05 ? 0 : playhead, null);
	}

	function playSlice(i: number) {
		selectedSlice = i;
		const s = scan.audioSlices[i];
		if (!s) return;
		void startPlayback(s.startSec, s.endSec);
	}

	/* ─── Playback clock: follows the real element, else simulates ────────── */
	$effect(() => {
		if (!browser || !playing || !hasAudio) return;
		let raf = 0;
		let prev = performance.now();
		const stopClock = () => {
			if (playhead >= maxEnd) playhead = 0;
			playing = false;
			playStopAt = null;
		};
		const tick = (now: number) => {
			if (scan.audioDataUrl && audioEl && !audioEl.paused) {
				playhead = audioEl.currentTime;
				if ((playStopAt !== null && playhead >= playStopAt) || playhead >= maxEnd) {
					try {
						audioEl.pause();
					} catch {
						/* noop */
					}
					stopClock();
					return;
				}
			} else if (!scan.audioDataUrl) {
				playhead += (now - prev) / 1000;
				if ((playStopAt !== null && playhead >= playStopAt) || playhead >= maxEnd) {
					stopClock();
					return;
				}
			} else {
				stopClock();
				return;
			}
			prev = now;
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	/* ─── Procedural demo frame art (per-case variety until Phase 4 media) ─ */
	function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
		ctx.beginPath();
		ctx.moveTo(x + r, y);
		ctx.arcTo(x + w, y, x + w, y + h, r);
		ctx.arcTo(x + w, y + h, x, y + h, r);
		ctx.arcTo(x, y + h, x, y, r);
		ctx.arcTo(x, y, x + w, y, r);
		ctx.closePath();
	}

	function drawDemoArt(ctx: CanvasRenderingContext2D) {
		const verdict = scan.verdict;
		const accent = VERDICT_META[verdict].color;
		// Base backdrop per case.
		const palettes: Record<string, [string, string]> = {
			'sample-x-9821': ['#b8d4e8', '#e8d9b8'],
			'sample-meet-exec': ['#1c2230', '#2b1626'],
			'sample-tiktok-4419': ['#274b63', '#7fb3d5'],
			'sample-yt-laundry': ['#23232b', '#3d3d52']
		};
		const [top, bottom] = palettes[scan.id] ?? ['#c9d4e0', '#eef0e8'];
		const g = ctx.createLinearGradient(0, 0, 0, FH);
		g.addColorStop(0, top);
		g.addColorStop(1, bottom);
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, FW, FH);

		if (scan.id === 'sample-x-9821') {
			// Street + crowd dots + held sign placeholder.
			ctx.fillStyle = 'rgba(0,0,0,0.18)';
			ctx.fillRect(0, FH * 0.66, FW, FH * 0.34);
			for (let i = 0; i < 26; i++) {
				const x = (i * 53 + 20) % FW;
				const y = FH * 0.52 + ((i * 37) % 60);
				ctx.fillStyle = i % 3 === 0 ? '#2b2f36' : '#4a4f58';
				ctx.beginPath();
				ctx.arc(x, y, 9, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillRect(x - 9, y + 9, 18, 26);
			}
			// The protest sign (matches the fake spot box).
			ctx.fillStyle = '#fdfdf5';
			ctx.strokeStyle = '#1E2024';
			ctx.lineWidth = 3;
			ctx.fillRect(FW * 0.6, FH * 0.36, FW * 0.28, FH * 0.24);
			ctx.strokeRect(FW * 0.6, FH * 0.36, FW * 0.28, FH * 0.24);
			ctx.fillStyle = '#1E2024';
			ctx.font = "700 17px 'Space Grotesk', sans-serif";
			ctx.fillText('WE DEMAND', FW * 0.625, FH * 0.45);
			ctx.fillText('CHANGE NOW', FW * 0.625, FH * 0.52);
		} else if (scan.id === 'sample-meet-exec') {
			// Meeting grid: participants + swapped executive tile + live waveform.
			const tiles: [number, number, string, string][] = [
				[FW * 0.06, FH * 0.14, '#2f6f52', 'Priya'],
				[FW * 0.36, FH * 0.1, '#3a2b52', 'Marcus (CFO)'],
				[FW * 0.7, FH * 0.14, '#274b63', 'Sam']
			];
			for (const [x, y, c, name] of tiles) {
				ctx.fillStyle = c;
				rr(ctx, x, y, FW * 0.24, FH * 0.44, 10);
				ctx.fill();
				ctx.fillStyle = '#e8b98a';
				ctx.beginPath();
				ctx.arc(x + FW * 0.12, y + FH * 0.17, 26, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = '#23232b';
				rr(ctx, x + FW * 0.12 - 30, y + FH * 0.17 + 24, 60, 44, 12);
				ctx.fill();
				ctx.fillStyle = 'rgba(255,255,255,0.9)';
				ctx.font = "600 12px 'JetBrains Mono', monospace";
				ctx.fillText(name, x + 10, y + FH * 0.44 - 10);
			}
			for (let i = 0; i < 64; i++) {
				const h = 8 + Math.abs(Math.sin(i * 0.7)) * 46;
				ctx.fillStyle = i < 20 ? '#10B981' : '#EF4444';
				ctx.fillRect(40 + i * 8.6, FH * 0.78 - h / 2, 5, h);
			}
			ctx.fillStyle = '#fff';
			ctx.font = "600 15px 'JetBrains Mono', monospace";
			ctx.fillText('● LIVE MEETING  00:13', 40, 40);
		} else if (scan.id === 'sample-tiktok-4419') {
			// Flood waves + caption bar.
			for (let r = 0; r < 5; r++) {
				ctx.strokeStyle = r % 2 ? '#bfe3f2' : '#5b93b5';
				ctx.lineWidth = 5;
				ctx.beginPath();
				for (let x = 0; x <= FW; x += 8) {
					const y = FH * 0.5 + r * 26 + Math.sin(x * 0.03 + r) * 10;
					if (x === 0) ctx.moveTo(x, y);
					else ctx.lineTo(x, y);
				}
				ctx.stroke();
			}
			ctx.fillStyle = 'rgba(0,0,0,0.55)';
			ctx.fillRect(FW * 0.05, FH * 0.74, FW * 0.9, FH * 0.16);
			ctx.fillStyle = '#fff';
			ctx.font = "700 19px 'Space Grotesk', sans-serif";
			ctx.fillText('🔴 LIVE: breaking flood downtown', FW * 0.08, FH * 0.845);
		} else {
			// Screen-laundered AI: laptop frame + moiré lines + synthetic room.
			ctx.fillStyle = '#101014';
			rr(ctx, FW * 0.08, FH * 0.1, FW * 0.84, FH * 0.72, 14);
			ctx.fill();
			const sg = ctx.createLinearGradient(0, FH * 0.14, 0, FH * 0.78);
			sg.addColorStop(0, '#8fd0c2');
			sg.addColorStop(1, '#4a6fa5');
			ctx.fillStyle = sg;
			ctx.fillRect(FW * 0.11, FH * 0.15, FW * 0.78, FH * 0.6);
			ctx.strokeStyle = 'rgba(255,255,255,0.28)';
			ctx.lineWidth = 1;
			for (let y = FH * 0.15; y < FH * 0.75; y += 4) {
				ctx.beginPath();
				ctx.moveTo(FW * 0.11, y);
				ctx.lineTo(FW * 0.89, y);
				ctx.stroke();
			}
			ctx.fillStyle = '#101014';
			ctx.font = "700 16px 'JetBrains Mono', monospace";
			ctx.fillText('▣ REC  iphone → laptop screen', FW * 0.14, FH * 0.7);
		}

		// Watermark tag.
		ctx.fillStyle = 'rgba(0,0,0,0.55)';
		rr(ctx, FW - 218, FH - 40, 206, 28, 14);
		ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.font = "600 12px 'JetBrains Mono', monospace";
		ctx.fillText(`DEMO FRAME · ${PLATFORM_LABEL[scan.platform] ?? scan.platform}`, FW - 202, FH - 21);
		// Accent edge in verdict color.
		ctx.fillStyle = accent;
		ctx.fillRect(0, 0, FW, 6);
	}

	function drawComposite() {
		if (!browser || !frameCanvas || !rawCanvas) return;
		const ctx = frameCanvas.getContext('2d');
		const raw = rawCanvas.getContext('2d');
		if (!ctx || !raw) return;
		// Raw layer: uploaded image or procedural art (forensics runs on THIS).
		if (customImg && ronStore.customImageUrl) {
			const iw = customImg.naturalWidth;
			const ih = customImg.naturalHeight;
			const scale = Math.max(FW / iw, FH / ih);
			const dw = iw * scale;
			const dh = ih * scale;
			raw.drawImage(customImg, (FW - dw) / 2, (FH - dh) / 2, dw, dh);
		} else {
			customImg = null;
			drawDemoArt(raw);
		}
		// Composite: raw + glowing spot boxes.
		ctx.clearRect(0, 0, FW, FH);
		ctx.drawImage(rawCanvas, 0, 0);
		for (const spot of scan.highlightedSpots) {
			const x = spot.x * FW;
			const y = spot.y * FH;
			const w = spot.w * FW;
			const h = spot.h * FH;
			const color = spot.isFake ? meta.color : '#10B981';
			ctx.save();
			ctx.strokeStyle = color;
			ctx.lineWidth = 3.5;
			ctx.shadowColor = color;
			ctx.shadowBlur = 18;
			rr(ctx, x, y, w, h, 12);
			ctx.stroke();
			ctx.restore();
			// Label pill (skip the prefix when the label already carries its own emoji).
			ctx.font = "700 13px 'Space Grotesk', sans-serif";
			const hasEmoji = /^[✅⚠️✓]/.test(spot.plainLabel.trimStart());
			const label = `${hasEmoji ? '' : spot.isFake ? '⚠️ ' : '✓ '}${spot.plainLabel}`;
			const tw = Math.min(ctx.measureText(label).width + 20, FW - x - 8);
			const ly = Math.max(10, y - 34);
			ctx.fillStyle = 'rgba(9,10,13,0.88)';
			rr(ctx, x, ly, tw, 26, 13);
			ctx.fill();
			ctx.fillStyle = '#F4F5F8';
			const maxChars = Math.max(12, Math.floor((tw - 20) / 7));
			ctx.fillText(truncateWords(label, maxChars), x + 10, ly + 17);
		}
		// Untracked: the redraw effects call drawComposite, so a tracked
		// increment would resubscribe them to frameVersion → infinite loop.
		untrack(() => frameVersion++);
	}

	/* Redraw triggers: scan + canvas mount. */
	$effect(() => {
		void scan.id;
		void frameCanvas;
		if (!browser || !frameCanvas) return;
		if (!rawCanvas) {
			rawCanvas = document.createElement('canvas');
			rawCanvas.width = FW;
			rawCanvas.height = FH;
		}
		if (!layerCanvas) {
			layerCanvas = document.createElement('canvas');
			layerCanvas.width = FW;
			layerCanvas.height = FH;
		}
		drawComposite();
	});

	/* Uploaded image loading. */
	$effect(() => {
		const url = ronStore.customImageUrl;
		if (!browser) return;
		if (!url) {
			customImg = null;
			drawComposite();
			return;
		}
		const img = new Image();
		img.onload = () => {
			customImg = img;
			drawComposite();
		};
		img.src = url;
	});

	/* ─── Forensic overlay pipeline (real worker output) ─────────────────── */
	function scheduleForensics() {
		if (!browser || !ronStore.showProof) return;
		if (forensicsTimer) clearTimeout(forensicsTimer);
		forensicsTimer = setTimeout(() => void runForensics(), 180);
	}

	async function runForensics() {
		if (!rawCanvas) return;
		const raw = rawCanvas.getContext('2d');
		if (!raw) return;
		const myRun = ++forensicsRunId;
		analyzing = true;
		try {
			const image = raw.getImageData(0, 0, FW, FH);
			const res = await analyzeImageData(image, { elaQuality: elaSens, fftCutoff: fftCut });
			if (myRun !== forensicsRunId) return;
			lastOverlay = { ela: res.elaMap, fft: res.fftMap, width: FW, height: FH, raw: image };
			engineName = res.engine;
			lastMs = Math.round(res.timings.totalMs);
			rebuildLayer();
		} catch {
			// Worker failure degrades silently — loupe shows "scanning" placeholder.
		} finally {
			if (myRun === forensicsRunId) analyzing = false;
		}
	}

	$effect(() => {
		if (!browser || !ronStore.showProof) return;
		void scan.id;
		void frameVersion;
		void elaSens;
		void fftCut;
		scheduleForensics();
	});

	/* Live regional ELA measured from the actual raw pixels (v2.1 honesty). */
	async function runLiveRegional() {
		if (!browser || !rawCanvas) return;
		const candidates =
			scan.highlightedSpots.length > 0
				? scan.highlightedSpots.map((s, i) => ({
						id: `M${i + 1}`,
						label: s.plainLabel,
						x: s.x,
						y: s.y,
						w: s.w,
						h: s.h
					}))
				: [{ id: 'M1', label: 'Full frame', x: 0.05, y: 0.05, w: 0.9, h: 0.9 }];
		const myRun = ++liveRegionalRun;
		try {
			const res = await computeRealRegionalForensics(rawCanvas, candidates);
			if (myRun !== liveRegionalRun) return;
			liveRegional = res;
			liveRegionalNote =
				scan.sourceType === 'file_upload'
					? 'Measured live from your upload on this device.'
					: 'Measured live from the displayed fixture pixels.';
		} catch {
			// Keep the previous measurement; the worker loupe still works.
		}
	}

	$effect(() => {
		if (!browser) return;
		void scan.id;
		void frameVersion;
		void ronStore.customImageUrl;
		const key = `${scan.id}|${ronStore.customImageUrl ?? ''}`;
		if (key === liveRegionalKey) return;
		liveRegionalKey = key;
		const t = setTimeout(() => void runLiveRegional(), 250);
		return () => clearTimeout(t);
	});

	$effect(() => {
		// Local-only params rebuild instantly (no worker round-trip).
		void loupeLayer;
		void ditherDensity;
		if (!browser || !ronStore.showProof || !lastOverlay) return;
		rebuildLayer();
	});

	function heatColor(v: number, stops: [number, number, number][]): [number, number, number] {
		const t = Math.min(1, Math.max(0, v / 255)) * (stops.length - 1);
		const i = Math.min(stops.length - 2, Math.floor(t));
		const f = t - i;
		const a = stops[i];
		const b = stops[i + 1];
		return [
			Math.round(a[0] + (b[0] - a[0]) * f),
			Math.round(a[1] + (b[1] - a[1]) * f),
			Math.round(a[2] + (b[2] - a[2]) * f)
		];
	}

	const BAYER = new Uint8Array([
		0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38,
		60, 28, 52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57,
		25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21
	]);

	function rebuildLayer() {
		if (!layerCanvas || !lastOverlay) return;
		const lctx = layerCanvas.getContext('2d');
		if (!lctx) return;
		const { ela, fft, width, height, raw } = lastOverlay;
		const out = lctx.createImageData(width, height);
		const px = width * height;
		if (loupeLayer === 'ela') {
			const stops: [number, number, number][] = [
				[9, 10, 13],
				[127, 29, 29],
				[239, 68, 68],
				[253, 224, 71],
				[255, 255, 255]
			];
			for (let i = 0; i < px; i++) {
				const [r, g, b] = heatColor(ela[i], stops);
				out.data[i * 4] = r;
				out.data[i * 4 + 1] = g;
				out.data[i * 4 + 2] = b;
				out.data[i * 4 + 3] = 255;
			}
		} else if (loupeLayer === 'fft') {
			const stops: [number, number, number][] = [
				[9, 10, 13],
				[76, 29, 149],
				[139, 92, 246],
				[103, 232, 249],
				[255, 255, 255]
			];
			for (let i = 0; i < px; i++) {
				const [r, g, b] = heatColor(fft[i], stops);
				out.data[i * 4] = r;
				out.data[i * 4 + 1] = g;
				out.data[i * 4 + 2] = b;
				out.data[i * 4 + 3] = 255;
			}
		} else if (loupeLayer === 'noise') {
			// Local high-pass: |luminance − 3×3 box blur|, amplified.
			const lum = new Float32Array(px);
			for (let i = 0; i < px; i++) {
				lum[i] = 0.299 * raw.data[i * 4] + 0.587 * raw.data[i * 4 + 1] + 0.114 * raw.data[i * 4 + 2];
			}
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					let sum = 0;
					let n = 0;
					for (let dy = -1; dy <= 1; dy++) {
						for (let dx = -1; dx <= 1; dx++) {
							const xx = x + dx;
							const yy = y + dy;
							if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
							sum += lum[yy * width + xx];
							n++;
						}
					}
					const hp = Math.abs(lum[y * width + x] - sum / n) * 3.2;
					const v = Math.min(255, hp);
					const o = (y * width + x) * 4;
					out.data[o] = v;
					out.data[o + 1] = v;
					out.data[o + 2] = v + 12 > 255 ? 255 : v + 12;
					out.data[o + 3] = 255;
				}
			}
		} else {
			// 1-bit Bayer dither over worker ELA with live density control.
			const gain = 0.35 + ditherDensity * 1.5;
			for (let y = 0; y < height; y++) {
				for (let x = 0; x < width; x++) {
					const i = y * width + x;
					const threshold = BAYER[(y % 8) * 8 + (x % 8)] * 4 * gain;
					const v = ela[i] > threshold ? 255 : 0;
					const o = i * 4;
					out.data[o] = v;
					out.data[o + 1] = v === 255 ? 240 : 8;
					out.data[o + 2] = v === 255 ? 200 : 12;
					out.data[o + 3] = 255;
				}
			}
		}
		lctx.putImageData(out, 0, 0);
	}

	/* Loupe paint loop (60 FPS while proof is on). */
	$effect(() => {
		if (!browser || !ronStore.showProof) return;
		let raf = 0;
		const paint = () => {
			paintLoupe();
			raf = requestAnimationFrame(paint);
		};
		raf = requestAnimationFrame(paint);
		return () => cancelAnimationFrame(raf);
	});

	function paintLoupe() {
		if (!loupeCanvas || !layerCanvas) return;
		const ctx = loupeCanvas.getContext('2d');
		if (!ctx) return;
		const S = loupeCanvas.width;
		ctx.clearRect(0, 0, S, S);
		ctx.save();
		ctx.beginPath();
		ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
		ctx.clip();
		if (lastOverlay) {
			const half = LOUPE_PX / 2;
			const sx = Math.min(FW - LOUPE_PX, Math.max(0, loupeX.current - half));
			const sy = Math.min(FH - LOUPE_PX, Math.max(0, loupeY.current - half));
			ctx.drawImage(layerCanvas, sx, sy, LOUPE_PX, LOUPE_PX, 0, 0, S, S);
		} else {
			ctx.fillStyle = '#090A0D';
			ctx.fillRect(0, 0, S, S);
			ctx.fillStyle = '#8C92A4';
			ctx.font = "600 13px 'JetBrains Mono', monospace";
			ctx.fillText(analyzing ? 'scanning…' : 'warming up…', S / 2 - 52, S / 2 + 5);
		}
		// Crosshair.
		ctx.strokeStyle = 'rgba(244,245,248,0.7)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(S / 2 - 14, S / 2);
		ctx.lineTo(S / 2 + 14, S / 2);
		ctx.moveTo(S / 2, S / 2 - 14);
		ctx.lineTo(S / 2, S / 2 + 14);
		ctx.stroke();
		ctx.restore();
		// Ring.
		ctx.strokeStyle = meta.color;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2);
		ctx.stroke();
	}

	function loupePoint(e: PointerEvent) {
		if (!stageBox) return;
		const rect = stageBox.getBoundingClientRect();
		const x = ((e.clientX - rect.left) / rect.width) * FW;
		const y = ((e.clientY - rect.top) / rect.height) * FH;
		loupeX.target = Math.min(FW - 8, Math.max(8, x));
		loupeY.target = Math.min(FH - 8, Math.max(8, y));
	}

	/* ─── Verified Human Receipt (C2PA camera-signed uploads ONLY) ────────── */
	const receiptUnlocked = $derived(
		scan.verdict === 'filtered' &&
			ronStore.provenance?.hasC2paManifest === true &&
			ronStore.provenance?.detectedAiGeneratorString == null
	);
	function downloadReceipt() {
		if (!browser || !receiptUnlocked) return;
		const lines = [
			'RON · VERIFIED HUMAN RECEIPT',
			'================================',
			`Title   : ${scan.title}`,
			`Source  : ${scan.source}`,
			`Verdict : ${meta.label} ${meta.kaomoji}`,
			`Sure    : ${scan.confidencePercent}% confident`,
			`Checked : ${new Date(scan.scannedAt).toLocaleString()}`,
			`SHA-256 : ${ronStore.provenance?.sha256Hash ?? 'n/a'}`,
			`C2PA    : manifest present, no AI generator tag`,
			'',
			'What this means:',
			`  ${scan.plainHeadline}`,
			'',
			'This receipt certifies that RON found a C2PA camera',
			'signature with no AI generator tag — human capture.',
			'Verify again any time at RON (Real or Not?).'
		];
		const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'ron-verified-human-receipt.txt';
		a.click();
		URL.revokeObjectURL(url);
		toast.success('Verified Human Receipt downloaded', {
			description: 'Share it to prove a human made this.'
		});
	}
</script>

<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
	<!-- ══════════ LEFT · Visual & Audio Dissection (7) ══════════ -->
	<div class="space-y-5 lg:col-span-7">
		<div
			class="ron-card overflow-hidden transition-colors duration-300"
			style={ronStore.showProof ? 'background-color: #090A0D; color: #F4F5F8;' : ''}
		>
			<div class="flex items-center justify-between gap-3 p-4 pb-2 sm:px-5">
				<div class="ron-mono text-[11px] font-bold uppercase tracking-wide opacity-70">
					Visual dissection stage
				</div>
				{#if ronStore.customImageUrl}
					<div class="ron-mono truncate text-[11px] font-semibold opacity-70">
						Previewing your upload: {ronStore.customImageName}
					</div>
				{/if}
			</div>
			<div class="p-4 pt-2 sm:p-5 sm:pt-2">
				{#if ronStore.customVideoUrl}
					<!-- svelte-ignore a11y_media_has_caption: user uploads ship no caption files; the live transcript renders in Voice Check below -->
					<video
						src={ronStore.customVideoUrl}
						controls
						preload="metadata"
						class="mb-3 max-h-72 w-full rounded-xl border-[1.5px] border-[var(--border-ink)] bg-black"
						aria-label={`Playable upload: ${scan.title}`}
					></video>
					{#if scan.keyframes && scan.keyframes.length > 0}
						<div class="ron-mono mb-1.5 text-[11px] font-bold uppercase tracking-wide opacity-70">
							Analyzed keyframes — tap to inspect one
						</div>
						<div class="mb-3 flex gap-2">
							{#each scan.keyframes as kf, ki (ki)}
								<button
									type="button"
									onclick={() => ronStore.setCustomImage(kf, `${scan.title} (keyframe ${ki + 1})`)}
									class="overflow-hidden rounded-lg border-[1.5px] border-[var(--border-ink)] transition hover:opacity-85"
									aria-label={`Inspect keyframe ${ki + 1} on the canvas`}
								>
									<img src={kf} alt="" class="h-16 w-28 object-cover" loading="lazy" />
								</button>
							{/each}
						</div>
					{/if}
				{/if}
				<!-- Canvas housing -->
				<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions: custom 2D canvas instrument — focusable, labelled, and fully arrow-key operable, matching no stock interactive role -->
				<div
					bind:this={stageBox}
					role="application"
					tabindex={ronStore.showProof ? 0 : -1}
					aria-label={ronStore.showProof
						? 'X-ray inspection surface. Drag, or use arrow keys, to move the loupe.'
						: `Media dissection canvas for ${scan.title}`}
					class="relative overflow-hidden rounded-xl border-[1.5px] outline-none {ronStore.showProof
						? 'border-[#2E3440] focus-visible:ring-2 focus-visible:ring-white/60'
						: 'border-[var(--border-ink)]'}"
					style="touch-action: none; cursor: {ronStore.showProof ? 'crosshair' : 'default'};"
					onpointerdown={(e) => {
						if (!ronStore.showProof) return;
						draggingLoupe = true;
						stageBox?.setPointerCapture(e.pointerId);
						loupePoint(e);
					}}
					onpointermove={(e) => {
						if (draggingLoupe && ronStore.showProof) loupePoint(e);
					}}
					onpointerup={() => (draggingLoupe = false)}
					onpointercancel={() => (draggingLoupe = false)}
					onkeydown={(e) => {
						if (!ronStore.showProof) return;
						const step = e.shiftKey ? 40 : 14;
						if (e.key === 'ArrowLeft') loupeX.target -= step;
						else if (e.key === 'ArrowRight') loupeX.target += step;
						else if (e.key === 'ArrowUp') loupeY.target -= step;
						else if (e.key === 'ArrowDown') loupeY.target += step;
						else return;
						e.preventDefault();
						loupeX.target = Math.min(FW - 8, Math.max(8, loupeX.target));
						loupeY.target = Math.min(FH - 8, Math.max(8, loupeY.target));
					}}
				>
					<canvas
						bind:this={frameCanvas}
						width={FW}
						height={FH}
						class="block h-auto w-full"
						aria-label="Media dissection canvas for {scan.title}"
					></canvas>
					{#if ronStore.showProof}
						<div class="pointer-events-none absolute inset-0 bg-black/30"></div>
						<!-- Draggable loupe -->
						<div
							class="pointer-events-none absolute z-10 h-40 w-40 sm:h-48 sm:w-48"
							style="left: {(loupeX.current / FW) * 100}%; top: {(loupeY.current / FH) *
								100}%; transform: translate(-50%, -50%);"
						>
							<canvas bind:this={loupeCanvas} width="220" height="220" class="h-full w-full"></canvas>
						</div>
						<div
							class="ron-mono pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-bold text-white"
						>
							<Crosshair class="h-3 w-3" />
							<span>Drag to inspect · {LOUPE_LAYERS[loupeLayer].label}</span>
						</div>
					{/if}
					{#if !hasSpots && !ronStore.showProof}
						<div
							class="ron-mono pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-bold text-white"
						>
							Audio-only evidence — see Voice Check below ↓
						</div>
					{/if}
				</div>

				<!-- X-Ray controls (proof only) -->
				{#if ronStore.showProof}
					<div class="mt-4 rounded-xl border border-[#2E3440] bg-white/5 p-4" transition:slide={{ duration: 240 }}>
						<div class="flex flex-wrap items-center gap-1.5">
							{#each Object.entries(LOUPE_LAYERS) as [key, info] (key)}
								<button
									type="button"
									onclick={() => (loupeLayer = key as LoupeLayer)}
									class="ron-mono rounded-full border px-3 py-1.5 text-[11px] font-bold transition {loupeLayer ===
									key
										? 'border-white bg-white text-black'
										: 'border-white/20 bg-transparent text-white/70 hover:bg-white/10'}"
								>
									{info.label}
								</button>
							{/each}
						</div>
						<div class="ron-mono mt-1.5 text-[11px] text-white/50">
							{LOUPE_LAYERS[loupeLayer].hint}
						</div>
						<div class="mt-3 grid gap-3 sm:grid-cols-3">
							<label class="block">
								<span class="ron-mono mb-1 flex justify-between text-[11px] font-bold text-white/70">
									<span>ELA sensitivity</span><span>{elaSens}</span>
								</span>
								<input
									type="range"
									min="50"
									max="95"
									bind:value={elaSens}
									class="w-full"
									style="accent-color: #EF4444;"
									aria-label="ELA sensitivity"
								/>
							</label>
							<label class="block">
								<span class="ron-mono mb-1 flex justify-between text-[11px] font-bold text-white/70">
									<span>FFT cutoff</span><span>{fftCut.toFixed(2)}</span>
								</span>
								<input
									type="range"
									min="0.1"
									max="0.8"
									step="0.05"
									bind:value={fftCut}
									class="w-full"
									style="accent-color: #8B5CF6;"
									aria-label="FFT frequency cutoff"
								/>
							</label>
							<label class="block">
								<span class="ron-mono mb-1 flex justify-between text-[11px] font-bold text-white/70">
									<span>Dither density</span><span>{Math.round(ditherDensity * 100)}%</span>
								</span>
								<input
									type="range"
									min="0"
									max="1"
									step="0.05"
									bind:value={ditherDensity}
									class="w-full"
									style="accent-color: #F59E0B;"
									aria-label="Dither density"
								/>
							</label>
						</div>
						<div class="ron-mono mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-white/50">
							<Cpu class="h-3.5 w-3.5" />
							<span>
								{analyzing ? 'analyzing frame…' : `engine: ${engineName} · ${lastMs}ms off-main-thread`}
							</span>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Truecaller-style audio slicer -->
		<div class="ron-card p-4 sm:p-5">
			<div class="mb-3 flex items-center justify-between gap-3">
				<div class="ron-mono flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
					<AudioLines class="h-4 w-4" /> Voice check — tap any slice
				</div>
				{#if hasAudio}
					<button
						type="button"
						onclick={toggleTimeline}
						class="ron-btn-hard inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 font-display text-xs font-bold text-canvas"
						aria-label={playing ? 'Pause playback' : hasRealAudio ? 'Play recorded audio' : 'Play simulated timeline'}
					>
						{#if playing}<Pause class="h-3.5 w-3.5" />{:else}<Play class="h-3.5 w-3.5" />{/if}
						<span>{playing ? 'Pause' : 'Play'} timeline</span>
					</button>
				{/if}
			</div>
			{#if hasAudio}
				{#if scan.audioDataUrl}
					<audio
						bind:this={audioEl}
						src={scan.audioDataUrl}
						preload="auto"
						class="hidden"
						aria-hidden="true"
						onended={() => {
							playing = false;
							playhead = 0;
							playStopAt = null;
						}}
					></audio>
				{/if}
				<div class="relative">
					<div class="flex w-full gap-1 overflow-hidden rounded-xl border-[1.5px] border-inkline bg-subtle p-1.5">
						{#each scan.audioSlices as s, i (s.startSec)}
							{@const st = STATUS_META[s.status]}
							{@const isActive = playing && activeSliceIdx === i}
							<button
								type="button"
								onclick={() => playSlice(i)}
								class="relative flex min-w-0 flex-col justify-end overflow-hidden rounded-lg px-1 pb-1 pt-2 transition {selectedSlice ===
								i
									? 'outline-2 outline-offset-1'
									: ''}"
								style="width: {((s.endSec - s.startSec) / maxEnd) * 100}%; background-color: {st.color}; filter: {isActive
									? 'brightness(1.25)'
									: 'none'}; {selectedSlice === i ? `outline-color: ${st.color};` : ''}"
								aria-label="Play slice {fmtTime(s.startSec)} to {fmtTime(s.endSec)}: {s.plainNote}"
							>
								<span class="flex h-12 items-end gap-[2px]">
									{#each Array.from({ length: barsForSlice(i) }) as _, b (b)}
										<span
											class="w-full rounded-sm bg-white/85"
											style="height: {barHeight(i, b)}%; opacity: 0.9;"
										></span>
									{/each}
								</span>
								<span class="ron-mono mt-1 truncate text-center text-[10px] font-bold text-white">
									{fmtTime(s.startSec)}–{fmtTime(s.endSec)}
								</span>
							</button>
						{/each}
					</div>
					<!-- Playhead -->
					<div
						class="pointer-events-none absolute top-0 bottom-0 w-[2.5px] rounded bg-black dark:bg-white"
						style="left: {(playhead / maxEnd) * 100}%;"
					></div>
				</div>
				{#if selected}
					{@const selMeta = STATUS_META[selected.status]}
					<div class="ron-well mt-3 p-4">
						<div class="flex flex-wrap items-center gap-2">
							<span
								class="ron-mono rounded-md px-2 py-0.5 text-[11px] font-bold text-white"
								style="background-color: {selMeta.color};"
							>
								{fmtTime(selected.startSec)}–{fmtTime(selected.endSec)}
							</span>
							<span class="font-display text-sm font-bold">{selected.speakerLabel}</span>
							<span
								class="ron-mono rounded-full border-[1.5px] border-inkline px-2 py-0.5 text-[11px] font-bold"
							>
								{selMeta.label}
							</span>
							{#if scan.audioDataUrl}
								<span class="ron-mono rounded-full bg-subtle px-2 py-0.5 text-[11px] font-bold text-muted">
									🔊 real recorded audio — tap any slice to hear it
								</span>
							{:else}
								<span class="ron-mono rounded-full bg-subtle px-2 py-0.5 text-[11px] font-bold text-muted">
									benchmark timing — simulated playback
								</span>
							{/if}
						</div>
						<p class="mt-2 text-sm font-medium">{selected.transcriptSnippet}</p>
						<p class="mt-1 text-[13px] text-muted">{selected.plainNote}</p>
					</div>
				{/if}
			{:else if ronStore.customVideoUrl}
				<p class="ron-mono rounded-xl bg-subtle p-4 text-[13px] font-semibold text-muted">
					{ronStore.videoAudioNote ?? 'Speech analysis for this video is still running — the visual verdict above already stands on its own evidence.'}
				</p>
			{:else}
				<p class="ron-mono rounded-xl bg-subtle p-4 text-[13px] font-semibold text-muted">
					No speech in this clip — photo mode. The verdict comes from the visual check above.
				</p>
			{/if}
		</div>

		<!-- Lower dock: Meter 1 + Meter 2 -->
		<div class="ron-card p-4 sm:p-5">
			<!-- Meter 1 · Media Integrity -->
			<div>
				<div class="mb-1.5 flex items-end justify-between gap-3">
					<span class="ron-mono text-[11px] font-bold uppercase tracking-wide text-muted">
						Meter 1 · Media Integrity (pixels, AudioSeal & C2PA)
					</span>
					<span class="ron-mono text-3xl font-bold" style="color: {trustColor};">
						{trustShown >= 80 ? '🟢 ' : ''}{trustShown}% Real
					</span>
				</div>
				<div class="h-4 overflow-hidden rounded-full border-[1.5px] border-inkline bg-subtle">
					<div
						class="h-full rounded-full transition-none"
						style="width: {trustShown}%; background-color: {trustColor};"
					></div>
				</div>
				<p class="ron-mono mt-1.5 text-[11px] font-semibold text-muted">
					Pixels, AudioSeal watermarks & C2PA provenance, combined live.
				</p>
			</div>
			<!-- Meter 2 · LIMC Origin & Evolution Briefing -->
			<div class="mt-3 rounded-xl border-[1.5px] border-inkline bg-subtle p-3.5">
				<div class="ron-mono text-[11px] font-bold uppercase tracking-wide text-muted">
					Meter 2 · Origin & Evolution Briefing · LIMC style, zero filler
				</div>
				{#if webPhase === 'idle'}
					<p class="mt-1 text-sm font-semibold">
						{scan.sourceType === 'file_upload'
							? 'Your upload has no story attached yet — run the live briefing below.'
							: 'No live briefing yet — run one below for the real backstory.'}
					</p>
					<button
						type="button"
						onclick={() => void runWebCheck()}
						class="ron-btn-hard mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 font-display text-xs font-bold text-canvas"
					>
						<ScanSearch class="h-3.5 w-3.5" strokeWidth={2.5} />
						<span>Run live briefing</span>
					</button>
				{:else if webPhase === 'loading'}
					<p class="ron-mono mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
						<Loader2 class="h-3.5 w-3.5 animate-spin" /> Researching the origin story…
					</p>
				{:else if webPhase === 'error'}
					<p class="mt-2.5 rounded-lg border-[1.5px] border-inkline bg-surface p-2.5 text-[13px] font-semibold">
						⚠️ Live briefing unavailable: {webError}
					</p>
					<button
						type="button"
						onclick={() => void runWebCheck()}
						class="ron-mono mt-1.5 text-[11px] font-bold underline underline-offset-2"
					>
						Try again
					</button>
				{:else if webBriefing.origin || webBriefing.evolution || webBriefing.impact}
					<div class="mt-2 space-y-2">
						{#if webBriefing.origin}
							<div class="rounded-lg border-[1.5px] border-inkline bg-surface p-2.5">
								<div class="ron-mono mb-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
									1 · Origin & First Appearance
								</div>
								<p class="text-[13px] font-medium leading-snug">{webBriefing.origin}</p>
							</div>
						{/if}
						{#if webBriefing.evolution}
							<div class="rounded-lg border-[1.5px] border-inkline bg-surface p-2.5">
								<div class="ron-mono mb-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
									2 · How It Evolved / Spread
								</div>
								<p class="text-[13px] font-medium leading-snug">{webBriefing.evolution}</p>
							</div>
						{/if}
						{#if webBriefing.impact}
							<div class="rounded-lg border-[1.5px] border-inkline bg-surface p-2.5">
								<div class="ron-mono mb-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">
									3 · Present Impact & Reality Check
								</div>
								<p class="text-[13px] font-medium leading-snug">{webBriefing.impact}</p>
							</div>
						{/if}
					</div>
					{#if webSources.length > 0}
						<div class="mt-2.5 flex flex-wrap gap-1.5">
							{#each webSources as s (s.url)}
								<a
									href={s.url}
									target="_blank"
									rel="noreferrer"
									title={s.snippet || s.url}
									class="ron-btn-hard inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface py-1 pl-1.5 pr-2.5"
								>
									<img
										src={`https://www.google.com/s2/favicons?domain=${hostOf(s.url)}&sz=32`}
										alt=""
										loading="lazy"
										class="h-4 w-4 shrink-0 rounded-full bg-subtle"
										onerror={(e) => {
											(e.currentTarget as HTMLImageElement).style.display = 'none';
										}}
									/>
									<span class="ron-mono truncate text-[11px] font-bold">
										{truncateWords(s.title, 34)}
									</span>
									<span class="ron-mono shrink-0 text-[10px] text-muted">{hostOf(s.url)}</span>
								</a>
							{/each}
						</div>
					{/if}
					<p class="ron-mono mt-1.5 text-[11px] text-muted">
						Live via {webModel} — {webSearched ? 'search ran' : 'no search needed'}.
					</p>
				{:else}
					<p class="mt-2 text-sm font-semibold">No earlier copies found on the public web.</p>
					{#if webSummary}
						<p class="mt-1 line-clamp-3 text-[13px] text-muted">{webSummary}</p>
					{/if}
				{/if}
			</div>
		</div>
	</div>

	<!-- ══════════ RIGHT · Verdict + Proof (5) ══════════ -->
	<div class="space-y-5 lg:col-span-5">
		<div class="ron-card overflow-hidden">
			<div class="flex flex-col gap-3 border-b-[1.5px] border-inkline p-5">
				<VerdictBadge verdict={scan.verdict} size="lg" />
				{#if scan.verdict === 'too_blurry'}
					<p class="rounded-xl border-[1.5px] border-dashed border-inkline bg-subtle p-3 text-[13px] font-semibold">
						⚪ Celebrated honesty: we would rather say Not Sure than guess on crushed pixels.
						Re-upload the original-quality file for a real verdict.
					</p>
				{/if}
				<p class="font-display text-[17px] font-semibold leading-snug">{scan.plainHeadline}</p>
				<div class="ron-mono flex items-center gap-2 text-xs text-muted">
					<span class="font-bold" style="color: {meta.color};">{scan.confidencePercent}% sure</span>
					<span aria-hidden="true">·</span>
					<span class="truncate">{scan.source}</span>
				</div>
			</div>
			<div class="space-y-3 p-5">
				<div class="ron-well p-3.5">
					<div class="ron-mono mb-1 text-[11px] font-bold uppercase tracking-wide text-[#10B981]">
						✅ What’s real
					</div>
					<p class="text-sm font-medium leading-relaxed">{scan.whatsReal}</p>
				</div>
				<div class="ron-well p-3.5">
					<div
						class="ron-mono mb-1 text-[11px] font-bold uppercase tracking-wide"
						style="color: {meta.color};"
					>
						⚠️ What was changed
					</div>
					<p class="text-sm font-medium leading-relaxed">{scan.whatsChanged}</p>
				</div>
				<div class="ron-well p-3.5" style="border-color: {meta.color};">
					<div class="ron-mono mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide">
						<ShieldCheck class="h-3.5 w-3.5" /> 🛡️ What you should do
					</div>
					<p class="text-sm font-medium leading-relaxed">{scan.safetyAction ?? SAFETY_ACTION[scan.verdict]}</p>
					{#if receiptUnlocked}
						<button
							type="button"
							onclick={downloadReceipt}
							class="ron-btn-hard mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 font-display text-xs font-bold text-canvas"
						>
							<Receipt class="h-3.5 w-3.5" /><Download class="h-3.5 w-3.5" />
							<span>Verified Human Receipt</span>
						</button>
					{:else if scan.verdict === 'filtered'}
						<p class="ron-mono mt-2 text-[11px] font-semibold text-muted">
							🔒 Receipt unlocks with a C2PA camera-signed upload (no AI generator tag).
						</p>
					{/if}
				</div>
			</div>
		</div>

		<!-- Story timeline -->
		<div class="ron-card p-5">
			<div class="ron-mono mb-3 text-[11px] font-bold uppercase tracking-wide text-muted">
				Where this came from
			</div>
			<ol class="space-y-2.5">
				{#each scan.whereItCameFrom.steps as step, i (step.date + i)}
					<li class="flex gap-3">
						<span
							class="ron-mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-inkline text-[11px] font-bold"
							style={i === 2 ? `background-color: ${meta.color}; color: #fff;` : ''}
						>
							{i + 1}
						</span>
						<div>
							<div class="ron-mono text-[11px] font-bold text-muted">
								{step.date} · {step.platform}
							</div>
							<p class="text-[13px] font-medium leading-snug">{step.whatHappened}</p>
						</div>
					</li>
				{/each}
			</ol>
			<p class="mt-3 rounded-xl border-[1.5px] border-dashed border-inkline bg-subtle p-3 text-[13px] font-semibold">
				⚠️ What scammers might try next: {scan.whereItCameFrom.nextScamWarning}
			</p>
		</div>

		<!-- Show Proof drawer -->
		<div class="ron-card overflow-hidden">
			<button
				type="button"
				onclick={() => ronStore.toggleProof()}
				aria-expanded={ronStore.showProof}
				class="inline-flex w-full items-center justify-center gap-2 px-4 py-3.5 font-display text-sm font-bold {ronStore.showProof
					? 'bg-ink text-canvas'
					: 'bg-surface text-ink'}"
			>
				<FlaskConical class="h-4 w-4" />
				<span>{ronStore.showProof ? '[ Hide Proof ▴ ]' : '[ 🔬 Show Proof ▾ ]'}</span>
				<ChevronDown class="h-4 w-4 transition-transform {ronStore.showProof ? 'rotate-180' : ''}" />
			</button>
			{#if ronStore.showProof}
				<div class="proof-housing p-5" transition:slide={{ duration: 240 }}>
					<!-- 1 · Pipeline trace (honestly labeled) -->
					<div class="ron-mono text-xs">
						<div class="mb-1.5 font-bold uppercase tracking-wide opacity-70">
							{scan.sourceType === 'file_upload'
								? 'Executed pipeline · measured live on your device'
								: 'Reference pipeline · ground-truth fixture'}
						</div>
						<div class="space-y-1">
							{#each scan.proof.metaModelsTrace as t (t.model + t.stage)}
								<div class="rounded-lg bg-white/5 px-3 py-1.5">
									<div class="flex items-center justify-between gap-3">
										<span class="truncate"><span class="font-bold">{t.model}</span> · {t.stage}</span>
										<span class="shrink-0 opacity-70">{t.durationMs}ms</span>
									</div>
									<div class="mt-0.5 truncate opacity-60">↳ {t.output}</div>
								</div>
							{/each}
						</div>
						{#if scan.sourceType !== 'file_upload'}
							<div class="mt-1.5 opacity-60">
								Fixture reference trace — live model calls land with the backend wiring. Upload your
								own file to see measured stages instead.
							</div>
						{/if}
					</div>
					<!-- 2 · Live regional ELA (computed from these pixels) -->
					<div class="ron-mono mt-5 text-xs">
						<div class="mb-1.5 font-bold uppercase tracking-wide opacity-70">
							Live regional ELA · computed, never hardcoded
						</div>
						{#if liveRegional}
							<div class="rounded-xl bg-white/5 p-3">
								<div class="flex items-center justify-between gap-2">
									<span class="font-bold">Overall anomaly: {liveRegional.overallAnomalyScore}/100</span>
									<span class="opacity-60">{liveRegionalNote}</span>
								</div>
								<div class="mt-2 space-y-1.5">
									{#each liveRegional.regionScores as r (r.maskId)}
										<div class="rounded-lg bg-white/5 px-3 py-2">
											<div class="flex items-center justify-between gap-2">
												<span class="truncate font-bold">{r.maskId} · {r.label}</span>
												<span
													class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
													style="background-color: {r.isFlaggedAnomaly ? '#EF4444' : '#10B981'};"
												>
													{r.isFlaggedAnomaly ? 'FLAGGED' : 'normal'}
												</span>
											</div>
											<div class="mt-0.5 opacity-70">
												inside {r.meanElaInside.toFixed(2)} · outside {r.meanElaOutside.toFixed(2)} ·
												σ {formatSigma(r.elaDivergenceSigma)} · HF×{r.highFreqEnergyRatio.toFixed(2)} ·
												if-hidden {r.ablationScoreIfHidden}
											</div>
										</div>
									{/each}
								</div>
								<img
									src={liveRegional.elaDataUrl}
									alt="Live ELA heatmap rendered from the actual pixels"
									class="mt-2 w-full rounded-lg border border-white/10"
								/>
							</div>
						{:else}
							<div class="rounded-xl bg-white/5 p-3 opacity-60">
								Measuring pixel residuals from the displayed frame…
							</div>
						{/if}
					</div>
					<!-- 3 · Live provenance (C2PA + SHA-256) -->
					<div class="ron-mono mt-5 text-xs">
						<div class="mb-1.5 font-bold uppercase tracking-wide opacity-70">
							Live provenance · header bytes + SHA-256
						</div>
						{#if ronStore.provenance}
							{@const p = ronStore.provenance}
							<div class="space-y-1 rounded-xl bg-white/5 p-3">
								<div class="flex justify-between gap-3"><span class="opacity-60">sha256</span><span class="truncate font-bold" title={p.sha256Hash}>{p.sha256Hash.slice(0, 20)}…</span></div>
								<div class="flex justify-between gap-3"><span class="opacity-60">C2PA manifest</span><span class="font-bold">{p.hasC2paManifest ? 'present ✓' : 'absent'}</span></div>
								<div class="flex justify-between gap-3"><span class="opacity-60">IPTC source</span><span class="truncate font-bold">{p.iptcDigitalSourceType ?? 'not declared'}</span></div>
								<div class="flex justify-between gap-3"><span class="opacity-60">AI generator tag</span><span class="truncate font-bold">{p.detectedAiGeneratorString ?? 'none found'}</span></div>
								<div class="flex justify-between gap-3"><span class="opacity-60">file size</span><span class="font-bold">{p.fileSizeMB}MB</span></div>
								<div class="flex justify-between gap-3"><span class="opacity-60">heavy compression</span><span class="font-bold">{p.isHeavilyCompressed ? 'yes — signal crushed' : 'no'}</span></div>
							</div>
						{:else}
							<div class="rounded-xl bg-white/5 p-3 opacity-60">
								Ground-truth fixture — upload your own file to see its live SHA-256 + C2PA report here.
							</div>
						{/if}
					</div>
					<!-- 4 · Muse Spark Open second opinion (live open-weight reasoning) -->
					<div class="ron-mono mt-5 text-xs">
						<div class="mb-1.5 font-bold uppercase tracking-wide opacity-70">
							Muse Spark Open second opinion · live
						</div>
						{#if sparkPhase === 'idle'}
							<button
								type="button"
								onclick={() => void runSparkOpinion()}
								class="rounded-full border border-white bg-white px-3.5 py-1.5 text-[11px] font-bold text-black transition hover:bg-white/85"
							>
								Run open-weight second opinion
							</button>
							<div class="mt-1.5 opacity-60">
								Reads the measured signals above and gives a plain-English second read.
							</div>
						{:else if sparkPhase === 'loading'}
							<div class="flex items-center gap-2 rounded-xl bg-white/5 p-3 opacity-70">
								<Loader2 class="h-4 w-4 animate-spin" /> Reasoning over the evidence…
							</div>
						{:else if sparkPhase === 'error'}
							<div class="rounded-xl bg-white/5 p-3">
								⚠️ {sparkError}
								<button
									type="button"
									onclick={() => void runSparkOpinion()}
									class="mt-1 block text-[11px] font-bold underline underline-offset-2"
								>
									Try again
								</button>
							</div>
						{:else}
							<div class="rounded-xl bg-white/5 p-3">
								<p class="text-[13px] leading-relaxed text-white/90" style="font-family: var(--font-display);">
									{sparkText || 'The model returned no text — treat this as inconclusive.'}
								</p>
								<div class="mt-1.5 opacity-60">via {sparkModel} (live inference)</div>
							</div>
						{/if}
					</div>
					<!-- 5 · Region masks (live for uploads, fixture reference otherwise) -->
					{#if scan.proof.samMasks.length > 0}
						<div class="ron-mono mt-5 text-xs">
							<div class="mb-1.5 flex items-center gap-1.5 font-bold uppercase tracking-wide opacity-70">
								<CircleDot class="h-3.5 w-3.5" />
								{scan.sourceType === 'file_upload' ? 'Region masks · measured live' : 'Region masks · fixture reference'}
							</div>
							<div class="grid gap-1.5">
								{#each scan.proof.samMasks as m (m.maskId)}
									<div class="rounded-lg bg-white/5 px-3 py-2">
										<div class="font-bold">{m.maskId} · {m.label}</div>
										<div class="opacity-70">
											ΔELA σ {formatSigma(m.elaDeltaSigma)}
											{#if scan.sourceType !== 'file_upload'}
												{' '}· IoU {m.iouScore.toFixed(2)} · FFT κ {m.fftPeakRatio.toFixed(2)} · KL {m.noiseprintKl.toFixed(2)} (fixture)
											{:else}
												{' '}· HF×{m.fftPeakRatio.toFixed(2)} (live)
											{/if}
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
					<div class="ron-mono mt-4 flex items-center gap-1.5 text-[11px] text-white/50">
						<MapPin class="h-3.5 w-3.5" />
						{#if hasAudio}<span class="flex items-center gap-1"><EyeOff class="h-3 w-3" /> Viseme drift in trace</span>{:else}<span class="flex items-center gap-1"><Eye class="h-3 w-3" /> Loupe the canvas to inspect seams</span>{/if}
						<span>·</span><span>{engineName} · {lastMs}ms</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
