<script lang="ts">
	import { openRonBuddyPip } from '#lib/components/RonBuddy.svelte';
	import { mountRonnieAvatar, type RonnieAvatarHandle } from '#lib/components/ronnieAvatar';
	import { MAX_UPLOAD_MB, ronStore } from '#lib/stores/ronStore.svelte';
	import { SAMPLE_SHORT_LABELS, VERDICT_META } from '#lib/types/ron';
	import { browser } from '$app/env';
	import { Link2, Loader2, Mic, ScanSearch, TriangleAlert, Upload } from '@lucide/svelte';
	import { scale } from 'svelte/transition';
	import { toast } from 'svelte-sonner';

	let linkInput = $state('');
	let dragOver = $state(false);
	let fileInput: HTMLInputElement | null = $state(null);
	let heroAvatarMount: HTMLDivElement | null = $state(null);

	$effect(() => {
		if (!browser || !heroAvatarMount) return;
		const handle: RonnieAvatarHandle = mountRonnieAvatar(heroAvatarMount);
		return () => handle.destroy();
	});

	/* Official brand marks, morphing every 1.5s (static strings — safe for {@html}). */
	const BRAND_LOGOS: { name: string; svg: string }[] = [
		{
			name: 'YouTube',
			svg: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="1.5" y="5" width="21" height="14" rx="4" fill="#FF0000"/><path d="M10 9.5v5l4.5-2.5z" fill="#fff"/></svg>`
		},
		{
			name: 'TikTok',
			svg: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g fill="#25F4EE" transform="translate(-0.9,0)"><ellipse cx="9.5" cy="17" rx="3.4" ry="2.8"/><rect x="11.7" y="5" width="2.3" height="12.6" rx="1"/><path d="M11.7 5c3.4.3 5.6 2.2 5.9 5.7l.1-2.7c-1.2-1.4-3.2-2.2-6-2.4z"/></g><g fill="#FE2C55" transform="translate(0.9,0)"><ellipse cx="9.5" cy="17" rx="3.4" ry="2.8"/><rect x="11.7" y="5" width="2.3" height="12.6" rx="1"/><path d="M11.7 5c3.4.3 5.6 2.2 5.9 5.7l.1-2.7c-1.2-1.4-3.2-2.2-6-2.4z"/></g><g fill="#1E2024"><ellipse cx="9.5" cy="17" rx="3.4" ry="2.8"/><rect x="11.7" y="5" width="2.3" height="12.6" rx="1"/><path d="M11.7 5c3.4.3 5.6 2.2 5.9 5.7l.1-2.7c-1.2-1.4-3.2-2.2-6-2.4z"/></g></svg>`
		},
		{
			name: 'X',
			svg: `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4.5 4.5l15 15M19.5 4.5l-15 15" stroke="#141517" stroke-width="2.8" stroke-linecap="round"/></svg>`
		},
		{
			name: 'Meet',
			svg: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="2.5" y="7" width="6" height="10" rx="3" fill="#00832D"/><path d="M8.5 7h4.2a3.5 3.5 0 0 1 0 7H8.5z" fill="#0066DA" opacity="0.85"/><rect x="8.5" y="4.5" width="8" height="4.6" rx="2.3" fill="#FFBA00"/><path d="M14.5 9.2l6-3.4v12.4l-6-3.4z" fill="#EA4335"/><circle cx="17.4" cy="12" r="1.6" fill="#fff"/></svg>`
		},
		{
			name: 'Zoom',
			svg: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="1.5" y="4" width="21" height="16" rx="4.5" fill="#2D8CFF"/><rect x="5" y="8.5" width="8" height="7" rx="1.5" fill="#fff"/><path d="M13.5 10.3l5-2.8v9l-5-2.8z" fill="#fff"/></svg>`
		}
	];
	let badgeIdx = $state(0);

	$effect(() => {
		if (!browser) return;
		const t = setInterval(() => {
			badgeIdx = (badgeIdx + 1) % BRAND_LOGOS.length;
		}, 1500);
		return () => clearInterval(t);
	});

	async function onCheck() {
		const input = linkInput.trim();
		if (!input) {
			toast.info('Paste a link or pick a ground-truth case below — no typing needed.');
			return;
		}
		const result = await ronStore.checkLink(input);
		if (!result) return; // Honest blocked-link card is showing instead — never a swapped fixture.
		const meta = VERDICT_META[result.verdict];
		toast.success(`Checked: ${meta.label}`, { description: result.plainHeadline });
	}

	function onListenLive() {
		ronStore.setMode('call');
		toast.success('Scanning the live meeting demo', {
			description: 'Voice-check slicing of the executive deepfake call below.'
		});
	}

	function onFloatActiveTab() {
		const scan = ronStore.activeScan;
		const meta = VERDICT_META[scan.verdict];
		const result = openRonBuddyPip({
			kaomoji: meta.kaomoji,
			verdictLabel: meta.label,
			color: meta.color,
			headline: scan.plainHeadline
		});
		if (result !== 'opened') {
			toast.info('Floating window is not supported in this browser', {
				description: 'Try Chrome / Edge on desktop, or use the Feed Sim tab.'
			});
			ronStore.setMode('sim');
		}
	}

	async function handleFiles(files: FileList | null) {
		if (!files || files.length === 0) return;
		const file = files[0];
		const outcome = await ronStore.analyzeUpload(file);
		if (fileInput) fileInput.value = '';
		if (!outcome.ok) {
			toast.error('Could not analyze that file', { description: outcome.error });
			return;
		}
		const meta = VERDICT_META[outcome.scan.verdict];
		toast.success(`Analyzed live: ${meta.label}`, { description: outcome.scan.plainHeadline });
	}
</script>

<section class="pt-8 sm:pt-12">
	<div class="mx-auto max-w-3xl text-center">
		<h1 class="font-display text-4xl font-bold tracking-tight sm:text-6xl">
			Real or Not? <span class="underline decoration-[3px] underline-offset-4">Know in seconds.</span>
		</h1>
		<p class="mx-auto mt-4 max-w-2xl text-base text-muted sm:text-lg">
			Paste a link from TikTok, X, or YouTube — or drop a photo, video, or voice clip (up to
			{MAX_UPLOAD_MB}MB) — to see what’s real and what was changed by AI.
		</p>
		<p class="ron-mono mx-auto mt-2 max-w-2xl text-[11px] font-semibold text-muted">
			Instagram / Facebook links can’t be auto-checked (Meta TOS) — upload the file instead.
		</p>
	</div>

	<div
		class="ron-card mx-auto mt-8 max-w-3xl p-2.5 transition sm:p-3 {dragOver
			? 'outline-2 outline-offset-2 outline-dashed'
			: ''}"
		style={dragOver ? 'outline-color: #10B981;' : ''}
		ondragover={(e) => {
			e.preventDefault();
			dragOver = true;
		}}
		ondragleave={() => (dragOver = false)}
		ondrop={(e) => {
			e.preventDefault();
			dragOver = false;
			void handleFiles(e.dataTransfer?.files ?? null);
		}}
		role="region"
		aria-label="Check a link, file, or live call"
	>
		<div class="flex flex-col gap-2.5">
			<div class="flex flex-1 items-center gap-2.5 rounded-xl bg-subtle px-4 py-3">
				<Link2 class="h-4 w-4 shrink-0 text-muted" />
				<input
					bind:value={linkInput}
					onkeydown={(e) => e.key === 'Enter' && onCheck()}
					placeholder="Paste a link, drop a file, or check a live call"
					class="w-full bg-transparent font-display text-[15px] font-medium outline-none placeholder:text-muted"
					aria-label="Paste a social link"
				/>
				{#key badgeIdx}
					{@const brand = BRAND_LOGOS[badgeIdx % BRAND_LOGOS.length]}
					<span
						in:scale={{ duration: 180 }}
						class="hidden shrink-0 items-center gap-1.5 rounded-full bg-white py-1 pl-1.5 pr-2.5 shadow-sm sm:inline-flex"
						title={brand.name}
						role="img"
						aria-label={`${brand.name} logo`}
					>
						{@html brand.svg}
						<span class="ron-mono text-[11px] font-bold text-[#141517]">{brand.name}</span>
					</span>
				{/key}
			</div>
			<div class="flex flex-col gap-2 sm:flex-row">
				<button
					type="button"
					onclick={onCheck}
					disabled={ronStore.isChecking}
					class="ron-btn-hard inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-6 py-3 font-display text-[15px] font-bold text-canvas disabled:opacity-60"
				>
					{#if ronStore.isChecking}
						<Loader2 class="h-4 w-4 animate-spin" />
						<span>Checking…</span>
					{:else}
						<ScanSearch class="h-4 w-4" strokeWidth={2.5} />
						<span>Check</span>
					{/if}
				</button>
				<button
					type="button"
					onclick={() => fileInput?.click()}
					disabled={ronStore.isChecking}
					class="ron-btn-hard inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-surface px-6 py-3 font-display text-[15px] font-bold text-ink disabled:opacity-60"
				>
					<Upload class="h-4 w-4" strokeWidth={2.5} />
					<span>Upload file</span>
				</button>
				<button
					type="button"
					onclick={onListenLive}
					disabled={ronStore.isChecking}
					class="ron-btn-hard inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-6 py-3 font-display text-[15px] font-bold text-white disabled:opacity-60"
					style="background-color: #EF4444;"
				>
					<Mic class="h-4 w-4" strokeWidth={2.5} />
					<span>🎥 Scan Live Zoom / Google Meet</span>
				</button>
			</div>
		</div>
		<input
			bind:this={fileInput}
			type="file"
			accept="video/*,image/*,audio/*"
			class="hidden"
			onchange={(e) => void handleFiles(e.currentTarget.files)}
			aria-label="Upload a video, photo, or voice recording"
		/>

		{#if ronStore.linkBlocked}
			<div
				class="mx-1.5 mt-2.5 rounded-xl border-[1.5px] border-inkline bg-subtle p-4"
				role="alert"
			>
				<div class="flex items-start gap-2.5">
					<TriangleAlert class="mt-0.5 h-5 w-5 shrink-0" strokeWidth={2.25} />
					<div>
						<div class="font-display text-sm font-bold">
							{#if ronStore.linkBlocked.reason === 'meta-tos'}
								Instagram / Facebook links can’t be auto-checked (Meta TOS)
							{:else}
								This platform blocked direct video stream access for this link
							{/if}
						</div>
						<p class="ron-mono mt-1 break-all text-[11px] text-muted">{ronStore.linkBlocked.input}</p>
						<p class="mt-1.5 text-[13px] font-medium">
							Drop the downloaded file here, or open the post in another tab and click [Float
							RON on Active Tab]. We never guess a verdict for a link we couldn’t actually open.
						</p>
						<div class="mt-2.5 flex flex-wrap gap-2">
							<button
								type="button"
								onclick={() => fileInput?.click()}
								class="ron-btn-hard inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-1.5 font-display text-xs font-bold text-canvas"
							>
								<Upload class="h-3.5 w-3.5" /> Drop the file here
							</button>
							<button
								type="button"
								onclick={onFloatActiveTab}
								class="ron-btn-hard inline-flex items-center gap-1.5 rounded-full bg-surface px-3.5 py-1.5 font-display text-xs font-bold text-ink"
							>
								💬 Float RON on Active Tab
							</button>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Verified ground-truth fixtures ($0 cache — never shown as a stranger link's verdict) -->
		<div class="flex flex-wrap items-center gap-2 px-1.5 pb-1.5 pt-2.5">
			<span class="ron-mono px-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
				Verified Ground-Truth Test Cases (Instant $0 Cache):
			</span>
			{#each ronStore.scans as s (s.id)}
				<button
					type="button"
					onclick={() => ronStore.selectScan(s.id)}
					class="ron-mono inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-3 py-1 text-xs font-semibold transition {ronStore.activeScanId ===
					s.id
						? 'border-inkline bg-ink text-canvas'
						: 'border-inkline bg-surface text-ink hover:bg-subtle'}"
				>
					<span
						class="inline-block h-2 w-2 rounded-full"
						style="background-color: {VERDICT_META[s.verdict].color}"
					></span>
				{SAMPLE_SHORT_LABELS[s.id] ?? s.title}
			</button>
			{/each}
		</div>
	</div>

	<!-- Co-primary: float Ronnie over any tab -->
	<div class="ron-card mx-auto mt-6 flex max-w-3xl flex-col items-center gap-4 p-5 sm:flex-row sm:p-6">
		<div bind:this={heroAvatarMount} aria-hidden="true" class="origin-center scale-[0.8]"></div>
		<div class="min-w-0 flex-1 text-center sm:text-left">
			<div class="font-display text-lg font-bold tracking-tight">
				Or float Ronnie over any tab 🤖
			</div>
			<p class="mt-1 text-sm text-muted">
				Ronnie watches YouTube, Zoom &amp; Meet with you — one tap scans the video
				<em>and</em> the voices, live.
			</p>
			<div class="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
				<button
					type="button"
					onclick={onFloatActiveTab}
					class="ron-btn-hard inline-flex items-center gap-1.5 rounded-full px-4 py-2 font-display text-[13px] font-bold text-white"
					style="background-color: #10B981;"
				>
					💬 Float Ronnie now
				</button>
				<button
					type="button"
					onclick={() => ronStore.setMode('sim')}
					class="ron-mono text-xs font-bold text-muted underline underline-offset-2 hover:text-ink"
				>
					or try the feed simulator →
				</button>
			</div>
		</div>
	</div>
</section>
