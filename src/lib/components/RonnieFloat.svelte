<script lang="ts">
	import { ronStore } from '#lib/stores/ronStore.svelte';
	import { VERDICT_META, type VerdictKey } from '#lib/types/ron';
	import {
		BUDDY_SYNC_CHANNEL,
		runBuddyLiveAnalysis
	} from '#lib/services/buddyAnalysis';
	import { createStreamVolumeTap } from '#lib/utils/audioWavEncoder';
	import { mountRonnieAvatar, type RonnieAvatarHandle, type RonnieState } from '#lib/components/ronnieAvatar';
	import { browser } from '$app/env';
	import { X } from '@lucide/svelte';
	import { onDestroy } from 'svelte';
	import { toast } from 'svelte-sonner';

	let open = $state(false);
	let avatarMount: HTMLDivElement | null = $state(null);
	let avatarHandle: RonnieAvatarHandle | null = null;
	let avatarState = $state<RonnieState>('idle');
	let bubbleText = $state('Hey, I’m Ronnie. Float me over any tab — I’ll scan it live.');
	let buddyScanId = $state<string | null>(null);
	let capturing = $state(false);
	let scanning = $state(false);
	let scanProgress = $state(0);
	let streamRef: MediaStream | null = $state(null);
	let videoEl: HTMLVideoElement | null = $state(null);
	let volumeTap: { getLevel: () => number; dispose: () => void } | null = null;
	let mouthRaf = 0;

	function setAvatar(state: RonnieState) {
		avatarState = state;
		avatarHandle?.setState(state);
	}

	$effect(() => {
		if (!browser || !open || !avatarMount) return;
		avatarHandle?.destroy();
		avatarHandle = mountRonnieAvatar(avatarMount);
		avatarHandle.setState(avatarState);
		const pump = () => {
			avatarHandle?.setVolume(volumeTap?.getLevel() ?? 0);
			mouthRaf = requestAnimationFrame(pump);
		};
		mouthRaf = requestAnimationFrame(pump);
		return () => {
			cancelAnimationFrame(mouthRaf);
			avatarHandle?.destroy();
			avatarHandle = null;
		};
	});

	$effect(() => {
		avatarHandle?.setState(avatarState);
	});

	onDestroy(() => {
		// onDestroy also runs during SSR teardown, where rAF/DOM don't exist.
		if (!browser) return;
		cancelAnimationFrame(mouthRaf);
		volumeTap?.dispose();
		volumeTap = null;
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

	async function captureAndScan() {
		if (!browser || capturing || scanning) return;
		capturing = true;
		bubbleText = 'Pick a tab — I’ll scan it the second it’s shared.';
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
			if (videoEl) videoEl.srcObject = picked;
			if (picked.getAudioTracks().length > 0) {
				volumeTap = createStreamVolumeTap(picked);
			} else {
				toast.warning('No audio track shared', {
					description: 'Visual check only — enable “Also share tab audio” for voice checks.'
				});
			}
			picked.getVideoTracks()[0]?.addEventListener('ended', () => {
				stopAll();
				bubbleText = 'Capture ended — tap Capture whenever you’re ready.';
			});
			await runLive(picked);
		} catch {
			bubbleText = 'No problem — tap Capture whenever you’re ready.';
		} finally {
			capturing = false;
		}
	}

	async function runLive(stream: MediaStream) {
		if (!videoEl) return;
		scanning = true;
		scanProgress = 0;
		setAvatar('scanning');
		bubbleText = 'Scanning this tab live — frames plus 3.5s of audio…';
		const trackLabel = stream.getVideoTracks()[0]?.label || 'Shared tab';
		const outcome = await runBuddyLiveAnalysis({
			stream,
			video: videoEl,
			tabLabel: trackLabel,
			platform: /youtube|youtu\.be/i.test(trackLabel)
				? 'youtube'
				: /meet|zoom/i.test(trackLabel)
					? 'zoom_meet'
					: 'upload',
			onProgress: (_message, frac) => {
				scanProgress = frac;
			}
		});
		scanning = false;
		if (!outcome.ok) {
			setAvatar('idle');
			bubbleText = outcome.error;
			return;
		}
		const liveScan = outcome.scan;
		buddyScanId = liveScan.id;
		ronStore.addBuddyScan(liveScan);
		try {
			new BroadcastChannel(BUDDY_SYNC_CHANNEL).postMessage({
				type: 'ronnie-scan-complete',
				scan: liveScan
			});
		} catch {
			/* sync channel unavailable — this tab already has it */
		}
		setAvatar(liveScan.verdict === 'too_blurry' ? 'idle' : liveScan.verdict);
		bubbleText = liveScan.plainHeadline;
		toast.success(`Ronnie verdict: ${VERDICT_META[liveScan.verdict].label}`, {
			description: liveScan.plainHeadline
		});
	}

	function openFullProof() {
		if (!buddyScanId) return;
		ronStore.selectBuddyScan(buddyScanId);
		ronStore.setMode('check');
		open = false;
	}

	function stopAll() {
		streamRef?.getTracks().forEach((t) => {
			try {
				t.stop();
			} catch {
				/* noop */
			}
		});
		streamRef = null;
		buddyScanId = null;
		setAvatar('idle');
		bubbleText = 'Hey, I’m Ronnie. Float me over any tab — I’ll scan it live.';
		if (videoEl) videoEl.srcObject = null;
	}
</script>

<div class="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2 sm:right-6 sm:bottom-6">
	{#if open}
		<div class="ron-card w-[320px] p-3.5" role="dialog" aria-label="Ronnie floating buddy">
			<div class="flex items-center gap-2.5">
				<div bind:this={avatarMount} aria-hidden="true" class="origin-bottom-right scale-[0.62]"></div>
				<div class="min-w-0 flex-1">
					<div class="font-display text-sm font-bold">Ronnie</div>
					<p class="mt-0.5 text-[12.5px] font-medium leading-snug">{bubbleText}</p>
					{#if buddyScanId}
						<button
							type="button"
							onclick={openFullProof}
							class="ron-btn-hard mt-2 inline-flex items-center gap-1 rounded-full bg-ink px-3 py-1.5 font-display text-[11px] font-bold text-canvas"
						>
							🔬 See Full Proof in RON ↗
						</button>
					{/if}
				</div>
			</div>
			{#if scanning}
				<div class="mt-2.5 h-2.5 overflow-hidden rounded-full border-[1.5px] border-inkline bg-subtle">
					<div
						class="h-full rounded-full"
						style="width: {Math.round(scanProgress * 100)}%; background-color: #06B6D4;"
					></div>
				</div>
			{/if}
			<div class="mt-2.5 flex gap-2">
				<button
					type="button"
					onclick={() => void captureAndScan()}
					disabled={capturing || scanning}
					class="ron-btn-hard flex-1 rounded-xl bg-ink px-3 py-2 font-display text-xs font-bold text-canvas disabled:opacity-60"
				>
					{#if capturing}Requesting…{:else if scanning}Scanning…{:else}📺 Capture Tab{/if}
				</button>
				{#if streamRef}
					<button
						type="button"
						onclick={stopAll}
						class="ron-btn-hard inline-flex items-center gap-1 rounded-xl bg-surface px-3 py-2 font-display text-xs font-bold text-ink"
					>
						<X class="h-3.5 w-3.5" /> Stop
					</button>
				{/if}
			</div>
			<video
				bind:this={videoEl}
				class="pointer-events-none absolute h-px w-px opacity-0"
				muted
				autoplay
				playsinline
				aria-hidden="true"
				tabindex="-1"
			></video>
		</div>
	{/if}
	<button
		type="button"
		onclick={() => (open = !open)}
		class="relative rounded-full transition-transform hover:scale-105"
		aria-label={open ? 'Close Ronnie buddy' : 'Open Ronnie buddy'}
		aria-expanded={open}
	>
		<span class="pointer-events-none absolute -top-1 -right-1 z-10 flex h-4 w-4">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style="background-color: #06B6D4;"></span>
			<span class="relative inline-flex h-4 w-4 rounded-full border-2 border-white" style="background-color: #06B6D4;"></span>
		</span>
		<span
			class="kaomoji ron-btn-hard flex h-14 w-14 items-center justify-center rounded-full text-xl text-white {avatarState ===
			'scanning'
				? 'animate-pulse'
				: ''}"
			style="background-color: {avatarState === 'idle'
				? '#1E2024'
				: avatarState === 'scanning'
					? '#06B6D4'
					: (VERDICT_META[avatarState as VerdictKey]?.color ?? '#1E2024')};"
		>
			{avatarState === 'idle' || avatarState === 'scanning'
				? '◉'
				: (VERDICT_META[avatarState as VerdictKey]?.dot ?? '◉')}
		</span>
	</button>
</div>
