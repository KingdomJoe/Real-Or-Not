<script lang="ts">
	import ThemeToggle from '#lib/components/ThemeToggle.svelte';
	import { openRonBuddyPip } from '#lib/components/RonBuddy.svelte';
	import { ronStore } from '#lib/stores/ronStore.svelte';
	import { VERDICT_META, type AppMode } from '#lib/types/ron';
	import { FlaskConical } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	const MODES: { id: AppMode; emoji: string; label: string; short: string }[] = [
		{ id: 'check', emoji: '🔍', label: 'Check Link or File', short: 'Check' },
		{ id: 'call', emoji: '🎥', label: 'Live Meeting Guard (Zoom / Meet)', short: 'Meet Guard' },
		{ id: 'sim', emoji: '💬', label: 'Floating Ronnie Sim', short: 'Feed Sim' }
	];

	function onFloatRon() {
		const scan = ronStore.activeScan;
		const meta = VERDICT_META[scan.verdict];
		// Synchronous gesture: requestWindow fires inside this click handler.
		const result = openRonBuddyPip({
			kaomoji: meta.kaomoji,
			verdictLabel: meta.label,
			color: meta.color,
			headline: scan.plainHeadline
		});
		if (result === 'opened') {
			toast.success('RON is floating on your screen', {
				description: 'Hit “Capture Tab / Meeting” inside Ronnie to run a live check.'
			});
		} else if (result === 'unsupported') {
			toast.info('Floating window is not supported in this browser', {
				description: 'Try Chrome / Edge on desktop, or use the Feed Sim tab.'
			});
			ronStore.setMode('sim');
		} else {
			toast.warning('Floating window was blocked', {
				description: 'Allow pop-ups for this site and try again.'
			});
		}
	}
</script>

<header
	class="sticky top-0 z-40 border-b-[1.5px] border-[var(--border-ink)] bg-[var(--bg-surface)]"
>
	<nav
		class="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-2.5 sm:px-6 lg:h-16 lg:flex-row lg:items-center lg:justify-between lg:gap-4 lg:py-0"
	>
		<!-- Left: logo -->
		<div class="flex items-center justify-between gap-3">
			<a href="/" class="flex items-center gap-2.5" aria-label="RON home">
				<span
					class="ron-mono ron-btn-hard flex h-9 items-center justify-center rounded-xl px-2.5 text-sm font-bold text-white"
					style="background-color: #10B981;"
				>
					&lt;•&gt;
				</span>
				<span class="leading-none">
					<span class="block font-display text-xl font-bold tracking-tight">RON</span>
					<span class="ron-mono block text-[10px] font-semibold uppercase tracking-widest text-muted">
						Real or Not
					</span>
				</span>
				<span
					class="ron-mono hidden rounded-full bg-ink px-2.5 py-1 text-[10px] font-bold text-canvas xl:inline-block"
					title="Open-weight attribution required by the Muse Model License"
				>
					Built with Muse Spark Open
				</span>
			</a>
			<div class="flex items-center gap-2 lg:hidden">
				<button
					type="button"
					onclick={onFloatRon}
					class="ron-btn-hard rounded-full bg-ink px-3.5 py-1.5 font-display text-xs font-bold text-canvas"
				>
					💬 Float RON
				</button>
				<ThemeToggle compact />
			</div>
		</div>

		<!-- Center: mode switcher -->
		<div
			class="flex items-center gap-1.5 overflow-x-auto rounded-full bg-subtle p-1.5"
			role="tablist"
			aria-label="Workspace mode"
		>
			{#each MODES as m (m.id)}
				<button
					type="button"
					role="tab"
					aria-selected={ronStore.appMode === m.id}
					onclick={() => ronStore.setMode(m.id)}
					class="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 font-display text-[13px] font-bold transition sm:px-4 {ronStore.appMode ===
					m.id
						? 'bg-ink text-canvas shadow'
						: 'text-muted hover:bg-surface hover:text-ink'}"
				>
					<span aria-hidden="true">{m.emoji}</span>
					<span class="hidden md:inline">{m.label}</span>
					<span class="md:hidden">{m.short}</span>
				</button>
			{/each}
		</div>

		<!-- Right: controls -->
		<div class="hidden items-center gap-2 lg:flex">
			<button
				type="button"
				onclick={() => ronStore.toggleProof()}
				aria-pressed={ronStore.showProof}
				class="ron-btn-hard inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 font-display text-[13px] font-bold {ronStore.showProof
					? 'bg-ink text-canvas'
					: 'bg-surface text-ink'}"
			>
				<FlaskConical class="h-4 w-4" strokeWidth={2.25} />
				<span>🔬 Show Proof: {ronStore.showProof ? 'ON' : 'OFF'}</span>
			</button>
			<button
				type="button"
				onclick={onFloatRon}
				class="ron-btn-hard rounded-full bg-ink px-4 py-2 font-display text-[13px] font-bold text-canvas"
			>
				💬 Float RON
			</button>
			<ThemeToggle compact />
		</div>

		<!-- Mobile: proof toggle row -->
		<div class="flex items-center gap-2 lg:hidden">
			<button
				type="button"
				onclick={() => ronStore.toggleProof()}
				aria-pressed={ronStore.showProof}
				class="ron-btn-hard inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3.5 py-2 font-display text-[13px] font-bold {ronStore.showProof
					? 'bg-ink text-canvas'
					: 'bg-surface text-ink'}"
			>
				<FlaskConical class="h-4 w-4" strokeWidth={2.25} />
				<span>🔬 Show Proof: {ronStore.showProof ? 'ON' : 'OFF'}</span>
			</button>
			<span class="ron-mono shrink-0 rounded-full bg-ink px-2.5 py-2 text-[10px] font-bold text-canvas">
				Muse Spark Open
			</span>
		</div>
	</nav>
</header>
