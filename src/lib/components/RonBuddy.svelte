<script module lang="ts">
	import { browser } from '$app/env';
	import { BUDDY_SYNC_CHANNEL, runBuddyLiveAnalysis } from '#lib/services/buddyAnalysis';
	import type { MediaScanResult, VerdictKey } from '#lib/types/ron';
	import { createStreamVolumeTap } from '#lib/utils/audioWavEncoder';
	import { mountRonnieAvatar, type RonnieState } from '#lib/components/ronnieAvatar';
	import { ronStore } from '#lib/stores/ronStore.svelte';

	export interface RonBuddyPipOpts {
		kaomoji: string;
		verdictLabel: string;
		color: string;
		headline: string;
	}

	export type RonBuddyPipResult = 'opened' | 'unsupported' | 'denied';

	type PipWindow = Window & {
		__ronCleanup?: () => void;
	};

	function verdictToRonnieState(verdict: VerdictKey): RonnieState {
		if (verdict === 'too_blurry') return 'idle';
		return verdict;
	}

	/**
	 * Phase 3 honest floating companion. requestWindow is called SYNCHRONOUSLY
	 * inside the click handler (no awaits before it) to preserve the user gesture.
	 * The buddy ALWAYS opens neutral — preset verdicts are never shown as live results.
	 */
	export function openRonBuddyPip(_opts: RonBuddyPipOpts): RonBuddyPipResult {
		if (!browser) return 'unsupported';
		const w = window as unknown as {
			documentPictureInPicture?: {
				requestWindow: (opts: { width: number; height: number }) => Promise<Window>;
			};
		};
		if (!w.documentPictureInPicture?.requestWindow) return 'unsupported';
		try {
			const pending = w.documentPictureInPicture.requestWindow({ width: 340, height: 155 });
			void pending.then(
				(pip) => setupRonBuddyPip(pip),
				() => {
					/* user dismissed — the inline buddy stays available */
				}
			);
			return 'opened';
		} catch {
			return 'denied';
		}
	}

	function copyAppStyles(pip: Window) {
		for (const sheet of Array.from(document.styleSheets)) {
			try {
				const rules = (sheet as CSSStyleSheet).cssRules;
				if (!rules || rules.length === 0) continue;
				let css = '';
				for (const rule of Array.from(rules)) css += `${rule.cssText}\n`;
				const style = pip.document.createElement('style');
				style.textContent = css;
				pip.document.head.appendChild(style);
			} catch {
				// Cross-origin sheet (e.g. Google Fonts) — skip honestly, fallback fonts apply.
			}
		}
		const base = pip.document.createElement('style');
		base.textContent = `
			* { box-sizing: border-box; margin: 0; }
			body { font-family: 'Space Grotesk', system-ui, sans-serif; background: #14161d; color: #f4f5f8; padding: 8px; font-size: 12px; }
			.ron-row { display: flex; align-items: center; gap: 8px; }
			.ronnie { width: 110px; height: 110px; }
			.ronnie-orb { inset: 10px; }
			.ron-bubble { flex: 1; min-width: 0; background: #fff; color: #141517; border: 1.5px solid #1E2024; border-radius: 12px; box-shadow: 2px 2px 0 #1E2024; padding: 8px 10px; }
			.ron-bubble p { font-size: 11.5px; line-height: 1.4; font-weight: 600; }
			.ron-proof { display: none; margin-top: 6px; border: 1.5px solid #1E2024; border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 700; cursor: pointer; background: #1E2024; color: #FAF9F5; }
			.ron-btn { border: 1.5px solid #1E2024; border-radius: 999px; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; background: #FAF9F5; color: #1E2024; }
			.ron-btn:disabled { opacity: .45; cursor: default; }
			.ron-banner { margin-top: 8px; border: 1.5px dashed #3a3f4b; border-radius: 8px; padding: 6px 8px; font-size: 11px; font-weight: 600; background: #1e212b; color: #f4f5f8; }
			.ron-bar { margin-top: 8px; height: 8px; border: 1.5px solid #3a3f4b; border-radius: 999px; overflow: hidden; background: #1e212b; }
			.ron-bar > div { height: 100%; width: 0%; background: #06B6D4; }
			.ron-status { margin-top: 6px; font-family: monospace; font-size: 10.5px; opacity: .8; }
			.ron-video { margin-top: 8px; width: 100%; max-height: 110px; border-radius: 8px; border: 1.5px solid #3a3f4b; background: #000; display: none; }
		`;
		pip.document.head.appendChild(base);
	}

	function el<K extends keyof HTMLElementTagNameMap>(
		pip: Window,
		tag: K,
		className: string,
		text?: string
	): HTMLElementTagNameMap[K] {
		const node = pip.document.createElement(tag);
		node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function setupRonBuddyPip(pip: Window) {
		const win = pip as PipWindow;
		win.__ronCleanup?.();
		pip.document.title = 'RON — floating buddy';
		copyAppStyles(pip);
		pip.document.body.innerHTML = '';

		const row = el(pip, 'div', 'ron-row');
		const avatarMount = el(pip, 'div', '');
		const bubble = el(pip, 'div', 'ron-bubble');
		const bubbleText = el(
			pip,
			'p',
			'',
			'Hey, I’m Ronnie. Tap Capture, pick a tab — I’ll scan it live.'
		);
		const proofBtn = el(pip, 'button', 'ron-proof', '🔬 See Full Proof in RON ↗');
		bubble.append(bubbleText, proofBtn);
		row.append(avatarMount, bubble);

		const btnRow = el(pip, 'div', 'ron-row');
		btnRow.style.marginTop = '8px';
		const captureBtn = el(pip, 'button', 'ron-btn', '📺 Capture Tab / Meeting');
		btnRow.append(captureBtn);
		const banner = el(pip, 'div', 'ron-banner', '');
		banner.style.display = 'none';
		const barWrap = el(pip, 'div', 'ron-bar', '');
		barWrap.style.display = 'none';
		const barFill = el(pip, 'div', '', '');
		barWrap.append(barFill);
		const video = pip.document.createElement('video');
		video.className = 'ron-video';
		video.muted = true;
		video.autoplay = true;
		video.playsInline = true;
		const status = el(pip, 'p', 'ron-status', 'Sleeping · capture a tab to wake RON up.');
		pip.document.body.append(row, btnRow, banner, barWrap, video, status);

		const avatar = mountRonnieAvatar(avatarMount);
		let stream: MediaStream | null = null;
		let closed = false;
		let volumeTap: { getLevel: () => number; dispose: () => void } | null = null;
		let mouthRaf = 0;
		let liveScan: MediaScanResult | null = null;

		const stopTracks = () => {
			stream?.getTracks().forEach((t) => {
				try {
					t.stop();
				} catch {
					/* already stopped */
				}
			});
			stream = null;
		};
		win.__ronCleanup = () => {
			closed = true;
			cancelAnimationFrame(mouthRaf);
			volumeTap?.dispose();
			volumeTap = null;
			stopTracks();
			avatar.destroy();
		};
		pip.addEventListener('pagehide', () => win.__ronCleanup?.());

		const pumpMouth = () => {
			if (closed) return;
			avatar.setVolume(volumeTap?.getLevel() ?? 0);
			mouthRaf = requestAnimationFrame(pumpMouth);
		};
		mouthRaf = requestAnimationFrame(pumpMouth);

		function showBanner(text: string) {
			banner.textContent = text;
			banner.style.display = 'block';
		}

		proofBtn.onclick = () => {
			if (!liveScan) return;
			ronStore.selectBuddyScan(liveScan.id);
			window.focus();
		};

		captureBtn.onclick = async () => {
			status.textContent = 'Requesting tab… pick a tab, window, or screen.';
			bubbleText.textContent = 'Pick a tab — I’ll scan it the second it’s shared.';
			try {
				stopTracks();
				volumeTap?.dispose();
				volumeTap = null;
				const picked = await navigator.mediaDevices.getDisplayMedia({
					video: true,
					audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
				});
				if (closed) {
					picked.getTracks().forEach((t) => t.stop());
					return;
				}
				stream = picked;
				const trackLabel = picked.getVideoTracks()[0]?.label || 'Shared tab';
				video.srcObject = picked;
				video.style.display = 'block';
				const hasAudio = picked.getAudioTracks().length > 0;
				if (!hasAudio) {
					showBanner(
						"🔇 Visual check active — no audio track shared. Select a Chrome Tab with 'Also share tab audio' enabled to check for AI voice clones."
					);
				} else {
					banner.style.display = 'none';
					volumeTap = createStreamVolumeTap(picked);
				}
				picked.getVideoTracks()[0]?.addEventListener('ended', () => {
					stopTracks();
					volumeTap?.dispose();
					volumeTap = null;
					video.style.display = 'none';
					avatar.setState('idle');
					status.textContent = 'Capture ended. Capture again anytime.';
					bubbleText.textContent = 'Capture ended — tap Capture whenever you’re ready.';
				});

				// Auto-start: cyan scanning state + full live analysis, no extra taps.
				avatar.setState('scanning');
				barWrap.style.display = 'block';
				barFill.style.width = '2%';
				captureBtn.disabled = true;
				status.textContent = 'Scanning video & voice…';
				bubbleText.textContent = 'Scanning this tab live — frames plus 3.5s of audio…';
				const outcome = await runBuddyLiveAnalysis({
					stream: picked,
					video,
					tabLabel: trackLabel,
					platform: /youtube|youtu\.be/i.test(trackLabel) ? 'youtube' : /meet|zoom/i.test(trackLabel) ? 'zoom_meet' : 'upload',
					onProgress: (message, frac) => {
						if (closed) return;
						status.textContent = message;
						barFill.style.width = `${Math.round(frac * 100)}%`;
					}
				});
				if (closed) return;
				captureBtn.disabled = false;
				barWrap.style.display = 'none';
				if (!outcome.ok) {
					avatar.setState('idle');
					status.textContent = outcome.error;
					bubbleText.textContent = outcome.error;
					return;
				}
				liveScan = outcome.scan;
				// Agentic background sync: store + Convex + every other RON tab.
				ronStore.addBuddyScan(liveScan);
				try {
					new BroadcastChannel(BUDDY_SYNC_CHANNEL).postMessage({
						type: 'ronnie-scan-complete',
						scan: liveScan
					});
				} catch {
					/* sync channel unavailable — main tab already has it */
				}
				avatar.setState(verdictToRonnieState(liveScan.verdict));
				status.textContent = `Verdict: ${liveScan.plainHeadline}`;
				bubbleText.textContent = liveScan.plainHeadline;
				proofBtn.style.display = 'inline-block';
			} catch {
				status.textContent = 'Capture dismissed — no worries, try again anytime.';
				bubbleText.textContent = 'No problem — tap Capture whenever you’re ready.';
			}
		};
	}
</script>

<script lang="ts">
	import { ronStore as buddyStore } from '#lib/stores/ronStore.svelte';
	import { VERDICT_META } from '#lib/types/ron';
	import {
		BUDDY_SYNC_CHANNEL as BUDDY_SYNC,
		runBuddyLiveAnalysis as runBuddyLive,
		startBuddySyncListener
	} from '#lib/services/buddyAnalysis';
	import type { TranscriptTurn } from '#lib/services/metaApi';
	import { createStreamVolumeTap as createVolumeTapInline } from '#lib/utils/audioWavEncoder';
	import { mountRonnieAvatar as mountAvatarInline, type RonnieAvatarHandle, type RonnieState as InlineRonnieState } from '#lib/components/ronnieAvatar';
	import { browser as clientOnly } from '$app/env';
	import { Loader2, Microscope, X } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';

	let avatarMount: HTMLDivElement | null = $state(null);
	let avatarHandle: RonnieAvatarHandle | null = null;
	let avatarState = $state<InlineRonnieState>('idle');
	let bubbleText = $state('Hey, I’m Ronnie. Tap Capture, pick a tab — I’ll scan it live.');
	let buddyScanId = $state<string | null>(null);

	let capturing = $state(false);
	let scanning = $state(false);
	let scanProgress = $state(0);
	let streamRef: MediaStream | null = $state(null);
	let hasAudio: boolean | null = $state(null);
	let audioNote = $state('');
	let liveTranscript = $state('');
	let liveTurns = $state<TranscriptTurn[]>([]);
	let sealVerdict = $state('');
	let videoEl: HTMLVideoElement | null = $state(null);
	let volumeTap: { getLevel: () => number; dispose: () => void } | null = null;
	let mouthRaf = 0;

	function stopMouth() {
		cancelAnimationFrame(mouthRaf);
		volumeTap?.dispose();
		volumeTap = null;
	}

	onDestroy(() => {
		stopMouth();
		avatarHandle?.destroy();
		avatarHandle = null;
		streamRef?.getTracks().forEach((t) => {
			try {
				t.stop();
			} catch {
				/* noop */
			}
		});
		streamRef = null;
	});

	$effect(() => {
		if (!clientOnly || !avatarMount || avatarHandle) return;
		avatarHandle = mountAvatarInline(avatarMount);
		avatarHandle.setState(avatarState);
		const pump = () => {
			avatarHandle?.setVolume(volumeTap?.getLevel() ?? 0);
			mouthRaf = requestAnimationFrame(pump);
		};
		mouthRaf = requestAnimationFrame(pump);
		return () => {
			cancelAnimationFrame(mouthRaf);
		};
	});

	$effect(() => {
		avatarHandle?.setState(avatarState);
	});

	// Cross-tab agentic sync: buddy scans finished in OTHER tabs land here too.
	$effect(() => {
		if (!clientOnly) return;
		return startBuddySyncListener((scan) => {
			buddyStore.addBuddyScan(scan);
			toast.success('Ronnie synced a fresh scan from another tab', {
				description: scan.plainHeadline
			});
		});
	});

	function setAvatar(state: InlineRonnieState) {
		avatarState = state;
		avatarHandle?.setState(state);
	}

	async function captureInline() {
		if (!clientOnly || capturing || scanning) return;
		capturing = true;
		audioNote = '';
		liveTranscript = '';
		liveTurns = [];
		sealVerdict = '';
		buddyScanId = null;
		try {
			const picked = await navigator.mediaDevices.getDisplayMedia({
				video: true,
				audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
			});
			streamRef?.getTracks().forEach((t) => {
				try {
					t.stop();
				} catch {
					/* noop */
				}
			});
			volumeTap?.dispose();
			streamRef = picked;
			hasAudio = picked.getAudioTracks().length > 0;
			if (videoEl) videoEl.srcObject = picked;
			picked.getVideoTracks()[0]?.addEventListener('ended', () => {
				stopInline();
				audioNote = 'Capture ended. Capture again anytime.';
			});
			if (!hasAudio) {
				audioNote =
					"🔇 Visual check active — no audio track shared. Select a Chrome Tab with 'Also share tab audio' enabled to check for AI voice clones.";
			} else {
				volumeTap = createVolumeTapInline(picked);
			}
			// Auto-start the full live analysis immediately — no extra taps.
			await runInlineLiveAnalysis(picked);
		} catch {
			audioNote = 'Capture dismissed — no worries, try again anytime.';
			bubbleText = 'No problem — tap Capture whenever you’re ready.';
		} finally {
			capturing = false;
		}
	}

	async function runInlineLiveAnalysis(stream: MediaStream) {
		if (!clientOnly || !videoEl) return;
		scanning = true;
		scanProgress = 0;
		setAvatar('scanning');
		bubbleText = 'Scanning this tab live — frames plus 3.5s of audio…';
		const trackLabel = stream.getVideoTracks()[0]?.label || 'Shared tab';
		const outcome = await runBuddyLive({
			stream,
			video: videoEl,
			tabLabel: trackLabel,
			platform: /youtube|youtu\.be/i.test(trackLabel)
				? 'youtube'
				: /meet|zoom/i.test(trackLabel)
					? 'zoom_meet'
					: 'upload',
			onProgress: (message, frac) => {
				audioNote = message;
				scanProgress = frac;
			}
		});
		scanning = false;
		if (!outcome.ok) {
			setAvatar('idle');
			audioNote = outcome.error;
			bubbleText = outcome.error;
			return;
		}
		const liveScan = outcome.scan;
		buddyScanId = liveScan.id;
		buddyStore.addBuddyScan(liveScan);
		try {
			new BroadcastChannel(BUDDY_SYNC).postMessage({
				type: 'ronnie-scan-complete',
				scan: liveScan
			});
		} catch {
			/* sync channel unavailable — this tab already has it */
		}
		setAvatar(
			liveScan.verdict === 'too_blurry' ? 'idle' : (liveScan.verdict as InlineRonnieState)
		);
		bubbleText = liveScan.plainHeadline;
		audioNote = '';
		sealVerdict =
			liveScan.audioSlices.length > 0
				? (() => {
						const flagged = liveScan.audioSlices.filter((s) => s.status !== 'real').length;
						return flagged > 0
							? `🔴 AudioSeal: ${flagged}s of this window looks AI-generated.`
							: `🟢 AudioSeal: this window sounds human — no synthetic watermark.`;
					})()
				: '⚪ AudioSeal: no speech turns in this window — visual verdict only.';
		const firstReal = liveScan.audioSlices.find((s) => s.transcriptSnippet);
		if (firstReal) {
			liveTranscript = liveScan.audioSlices.map((s) => s.transcriptSnippet).join(' ');
			liveTurns = liveScan.audioSlices.map((s, i) => ({
				turnId: i + 1,
				startMs: Math.round(s.startSec * 1000),
				endMs: Math.round(s.endSec * 1000),
				transcript: s.transcriptSnippet,
				speaker: s.speakerLabel
			}));
		}
		toast.success(`Ronnie verdict: ${VERDICT_META[liveScan.verdict].label}`, {
			description: liveScan.plainHeadline
		});
	}

	function openFullProof() {
		if (!buddyScanId) return;
		buddyStore.selectBuddyScan(buddyScanId);
		buddyStore.setMode('check');
	}

	function stopInline() {
		streamRef?.getTracks().forEach((t) => {
			try {
				t.stop();
			} catch {
				/* noop */
			}
		});
		streamRef = null;
		hasAudio = null;
		audioNote = '';
		liveTranscript = '';
		liveTurns = [];
		sealVerdict = '';
		buddyScanId = null;
		setAvatar('idle');
		bubbleText = 'Hey, I’m Ronnie. Tap Capture, pick a tab — I’ll scan it live.';
		if (videoEl) videoEl.srcObject = null;
	}
</script>

<div class="ron-card p-4 sm:p-5">
	<div class="flex items-start justify-between gap-3">
		<div class="flex min-w-0 flex-1 items-center gap-3">
			<div bind:this={avatarMount} aria-hidden="true"></div>
			<div class="min-w-0 flex-1">
				<div class="font-display text-[15px] font-bold">Ronnie · Floating Buddy</div>
				<div class="ron-mono mb-1.5 text-[11px] font-semibold text-muted">
					{streamRef ? (hasAudio ? 'Tab live · video + audio' : 'Tab live · video only') : 'Sleeping · capture a tab to wake up'}
				</div>
				<div class="rounded-xl border-[1.5px] border-inkline bg-subtle p-2.5">
					<p class="text-[13px] font-semibold leading-snug">{bubbleText}</p>
					{#if buddyScanId}
						<button
							type="button"
							onclick={openFullProof}
							class="ron-btn-hard mt-2 inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 font-display text-xs font-bold text-canvas"
						>
							<Microscope class="h-3.5 w-3.5" /> 🔬 See Full Proof in RON ↗
						</button>
					{/if}
				</div>
			</div>
		</div>
		{#if streamRef}
			<button
				type="button"
				onclick={stopInline}
				class="ron-btn-hard inline-flex shrink-0 items-center gap-1 rounded-full bg-surface px-3 py-1.5 font-display text-xs font-bold text-ink"
			>
				<X class="h-3.5 w-3.5" /> Stop
			</button>
		{/if}
	</div>

	<div class="mt-3 flex flex-wrap gap-2">
		<button
			type="button"
			onclick={() => void captureInline()}
			disabled={capturing || scanning}
			class="ron-btn-hard inline-flex items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 font-display text-[13px] font-bold text-canvas disabled:opacity-60"
		>
			{#if capturing}
				<Loader2 class="h-4 w-4 animate-spin" /><span>Requesting…</span>
			{:else if scanning}
				<Loader2 class="h-4 w-4 animate-spin" /><span>Scanning live…</span>
			{:else}
				<span>📺 Capture Tab / Meeting</span>
			{/if}
		</button>
	</div>

	{#if scanning}
		<div class="mt-3">
			<div class="ron-mono mb-1 text-[11px] font-bold text-muted">Live analysis in progress</div>
			<div class="h-3 overflow-hidden rounded-full border-[1.5px] border-inkline bg-subtle">
				<div class="h-full rounded-full" style="width: {Math.round(scanProgress * 100)}%; background-color: #06B6D4;"></div>
			</div>
		</div>
	{/if}

	{#if streamRef}
		<video
			bind:this={videoEl}
			class="mt-3 max-h-56 w-full rounded-xl border-[1.5px] border-inkline bg-black"
			muted
			autoplay
			playsinline
			aria-label="Captured tab preview"
		></video>
	{/if}

	{#if sealVerdict}
		<p class="mt-3 rounded-xl border-[1.5px] border-inkline bg-subtle p-3 text-[13px] font-bold">
			{sealVerdict}
		</p>
	{/if}

	{#if liveTranscript}
		<div class="ron-well mt-3 p-3.5">
			<div class="ron-mono mb-1 text-[11px] font-bold uppercase tracking-wide text-muted">
				Heard in this window · Muse Voice Transcribe (live)
			</div>
			<p class="text-sm font-medium leading-relaxed">“{liveTranscript}”</p>
			{#if liveTurns.length > 0}
				<ul class="mt-2 space-y-1">
					{#each liveTurns as turn (turn.turnId)}
						<li class="ron-mono text-[11px] text-muted">
							<span class="font-bold text-ink">
								{Math.floor(turn.startMs / 1000)}s–{Math.floor(turn.endMs / 1000)}s
							</span>
							{#if turn.speaker}<span> · {turn.speaker}</span>{/if}
							<span> — {turn.transcript}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}

	{#if audioNote}
		<p class="mt-3 rounded-xl border-[1.5px] border-dashed border-inkline bg-subtle p-3 text-[13px] font-semibold">
			{audioNote}
		</p>
	{/if}
</div>
