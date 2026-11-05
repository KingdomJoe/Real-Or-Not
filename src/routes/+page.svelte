<script lang="ts">
	import FeedSim from '#lib/components/FeedSim.svelte';
	import MediaStage from '#lib/components/MediaStage.svelte';
	import RonBuddy from '#lib/components/RonBuddy.svelte';
	import UniversalInputBar from '#lib/components/UniversalInputBar.svelte';
	import { ronStore } from '#lib/stores/ronStore.svelte';
	import { forensicsEngine } from '#lib/workers/forensics-client';
	import { browser } from '$app/env';
	import { Cpu, ShieldCheck, Video } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	let engine = $state<'rust-wasm' | 'typescript-worker' | 'loading'>('loading');

	$effect(() => {
		if (!browser) return;
		forensicsEngine()
			.then((e) => (engine = e))
			.catch(() => (engine = 'typescript-worker'));
	});

	$effect(() => {
		if (!browser) return;
		ronStore.syncFromConvex().then((ok) => {
			if (ok && ronStore.convexConnected) toast.success('Convex real-time sync connected');
		});
	});
</script>

{#if ronStore.appMode === 'sim'}
	<div class="mx-auto mt-8 max-w-3xl">
		<RonBuddy />
	</div>
	<FeedSim />
{:else}
	{#if ronStore.appMode === 'call'}
		<div
			class="ron-card mx-auto mt-8 flex max-w-3xl items-start gap-3 p-4"
			style="border-color: #EF4444;"
			role="note"
			aria-label="Live meeting guard briefing"
		>
			<span
				class="ron-btn-hard flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
				style="background-color: #EF4444;"
			>
				<Video class="h-5 w-5" strokeWidth={2.25} />
			</span>
			<div>
				<div class="font-display text-[15px] font-bold">🎥 Live Meeting Guard (Zoom / Meet)</div>
				<p class="mt-0.5 text-sm text-muted">
					The meeting below starts real — then an AI-cloned executive joins and pushes an urgent
					payment. Tap any voice slice to hear what was said.
				</p>
			</div>
		</div>
	{/if}

	<UniversalInputBar />

	<div class="mt-10">
		<MediaStage />
	</div>

	<div
		class="ron-mono mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-2 text-[11px] font-semibold text-muted"
	>
		<span class="inline-flex items-center gap-1.5 rounded-full bg-subtle px-3 py-1">
			<Cpu class="h-3.5 w-3.5" />
			{#if engine === 'loading'}
				<span class="animate-pulse-soft">probing signal engine…</span>
			{:else if engine === 'rust-wasm'}
				<span>signal engine: rust-wasm ⚡</span>
			{:else}
				<span>signal engine: typescript-worker (build wasm for max speed)</span>
			{/if}
		</span>
		<span class="inline-flex items-center gap-1.5 rounded-full bg-subtle px-3 py-1">
			<ShieldCheck class="h-3.5 w-3.5" />
			{#if ronStore.convexConnected}
				<span>convex: live sync</span>
			{:else}
				<span>convex: offline demo mode (5 local cases)</span>
			{/if}
		</span>
	</div>

	<p class="ron-mono mx-auto mt-4 max-w-3xl text-center text-xs leading-relaxed text-muted">
		Phase 2: universal checker · meeting slicer · X-ray loupe · living avatar buddy.<br />
		Phase 3: floating buddy with honest tab capture + 3.5s audio window (sim tab above).
	</p>
{/if}
