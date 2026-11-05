<script lang="ts">
	import { ronStore } from '#lib/stores/ronStore.svelte';
	import { SAMPLE_SHORT_LABELS, VERDICT_META } from '#lib/types/ron';
	import { browser } from '$app/env';
	import { Loader2, MessagesSquare } from '@lucide/svelte';

	/* Mock social posts mapped from real demo scans (judge safety net). */
	const posts = $derived(
		ronStore.scans
			.filter((s) => s.sourceType === 'social_link')
			.map((s) => ({
				scan: s,
				meta: VERDICT_META[s.verdict],
				author:
					s.platform === 'x'
						? '@breaking · 2h'
						: s.platform === 'tiktok'
							? '@news · 5h'
							: '@shorts · 3d',
				body:
					s.id === 'sample-x-9821'
						? 'WATCH: street interview takes a shocking turn 😳🎤'
						: s.id === 'sample-tiktok-4419'
							? '🔴 LIVE: breaking flood downtown — share before it’s removed!!'
							: 'This laundry robot is INSANE 🤖👕 link in bio!!'
			}))
	);

	let focusIdx = $state(0);
	let checking = $state(false);
	let checkedIdx = $state<number | null>(null);
	const focused = $derived(posts[focusIdx] ?? null);
	const verdict = $derived(
		checkedIdx !== null && posts[checkedIdx] ? posts[checkedIdx].meta : null
	);

	async function checkFocused() {
		if (!browser || checking || !focused) return;
		checking = true;
		checkedIdx = null;
		// Mimic the ~1.2s floating-buddy check latency.
		await new Promise((r) => setTimeout(r, 1200));
		checkedIdx = focusIdx;
		checking = false;
	}

	function openInRon() {
		if (checkedIdx === null || !posts[checkedIdx]) return;
		ronStore.selectScan(posts[checkedIdx].scan.id);
		ronStore.setMode('check');
		ronStore.showProof = true;
	}
</script>

<section class="mx-auto max-w-3xl pt-8 sm:pt-12">
	<div class="text-center">
		<div
			class="ron-mono inline-flex items-center gap-2 rounded-full bg-subtle px-3 py-1 text-xs font-semibold text-muted"
		>
			<MessagesSquare class="h-3.5 w-3.5" />
			<span>Phase 3 live · use “Float RON” above for the always-on-top buddy</span>
		</div>
		<h1 class="mt-4 font-display text-3xl font-bold tracking-tight sm:text-5xl">
			Try Floating RON on a Live Feed.
		</h1>
		<p class="mx-auto mt-3 max-w-xl text-base text-muted">
			Scroll the mock feed, tap a post, then tap RON — one tap tells you what’s real.
		</p>
	</div>

	<div class="relative mt-8">
		<!-- Mock feed -->
		<div class="max-h-[560px] space-y-3 overflow-y-auto rounded-2xl bg-subtle p-3">
			{#each posts as p, i (p.scan.id)}
				<button
					type="button"
					onclick={() => {
						focusIdx = i;
						checkedIdx = null;
					}}
					class="ron-card block w-full p-4 text-left transition {focusIdx === i
						? 'outline-2 outline-offset-2'
						: 'opacity-80 hover:opacity-100'}"
					style={focusIdx === i ? `outline-color: ${p.meta.color};` : ''}
				>
					<div class="flex items-center justify-between gap-2">
						<span class="ron-mono text-[11px] font-bold text-muted">
							{SAMPLE_SHORT_LABELS[p.scan.id] ?? p.scan.platform} · {p.author}
						</span>
						{#if checkedIdx === i}
							<span
								class="ron-mono rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
								style="background-color: {p.meta.color};"
							>
								{p.meta.kaomoji} {p.meta.label}
							</span>
						{/if}
					</div>
					<p class="mt-1.5 font-display text-[15px] font-semibold leading-snug">{p.body}</p>
					<div
						class="mt-2.5 flex h-24 items-end justify-between overflow-hidden rounded-xl p-2.5"
						style="background: linear-gradient(135deg, {p.meta.color}33, var(--bg-subtle)); border: 1.5px solid {p.meta.color}55;"
					>
						<span class="ron-mono text-[11px] font-bold opacity-60">▶ mock {p.scan.platform} media</span>
						<span class="ron-mono text-[11px] opacity-60">♡ 2.1k · ⇪ 480 · ↗ share</span>
					</div>
				</button>
			{/each}
		</div>

		<!-- Floating RON avatar -->
		<div class="sticky bottom-4 mt-4 flex justify-center">
			<div class="ron-card flex max-w-md flex-col items-center gap-2 p-3">
				<div class="flex items-center gap-2.5">
					<button
						type="button"
						onclick={() => void checkFocused()}
						disabled={checking}
						class="animate-ron-float kaomoji ron-btn-hard rounded-full px-4 py-2.5 text-sm text-white disabled:opacity-70"
						style="background-color: {checking
							? '#5E636E'
							: verdict
								? verdict.color
								: '#1E2024'};"
						aria-label={checking ? 'RON is checking' : 'Tap RON to check this post'}
					>
						{#if checking}
							<span class="inline-flex items-center gap-2">
								<Loader2 class="h-4 w-4 animate-spin" /> checking…
							</span>
						{:else if verdict}
							{verdict.kaomoji}
						{:else}
							{'{ -_- }'}
						{/if}
					</button>
					<div class="ron-mono text-[11px] font-semibold text-muted">
						{#if checking}RON is looking…{:else if verdict}RON checked ✓{:else}Sleeping · tap to check{/if}
					</div>
				</div>
				{#if checkedIdx !== null && posts[checkedIdx]}
					<div class="w-full rounded-xl bg-subtle p-3 text-center">
						<p class="text-[13px] font-semibold leading-snug">
							{checkedIdx === 0 && posts[checkedIdx].scan.id === 'sample-x-9821'
								? 'Hold up! Most of this clip is real, but the voice at 0:04 was changed by AI.'
								: posts[checkedIdx].scan.plainHeadline}
						</p>
						<button
							type="button"
							onclick={openInRon}
							class="ron-mono mt-1.5 text-xs font-bold underline underline-offset-2"
							style="color: {posts[checkedIdx].meta.color};"
						>
							See Full Proof in RON →
						</button>
					</div>
				{/if}
			</div>
		</div>
	</div>
</section>
