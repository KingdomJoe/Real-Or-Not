<script lang="ts">
	import '../app.css';
	import favicon from '#lib/assets/favicon.svg';
	import Navbar from '#lib/components/Navbar.svelte';
	import RonnieFloat from '#lib/components/RonnieFloat.svelte';
	import { ronStore } from '#lib/stores/ronStore.svelte';
	import { browser } from '$app/env';
	import { PUBLIC_CONVEX_URL } from '$app/env/public';
	import { setupConvex } from 'convex-svelte';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from 'svelte-sonner';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Convex real-time sync — only when PUBLIC_CONVEX_URL is configured.
	// The ronStore works fully offline otherwise (pre-loaded forensic cases).
	$effect(() => {
		if (!browser) return;
		if (!PUBLIC_CONVEX_URL) return;
		setupConvex(PUBLIC_CONVEX_URL);
	});

	// Backend health probe — drives the honest Navbar status pill.
	$effect(() => {
		if (!browser) return;
		void ronStore.refreshBackendHealth();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>RON — Real or Not? Know in seconds.</title>
</svelte:head>

<ModeWatcher defaultMode="light" />
<Toaster position="bottom-right" richColors closeButton />

<div class="min-h-screen bg-canvas text-ink">
	<Navbar />

	<main class="mx-auto w-full max-w-7xl px-4 pb-24 sm:px-6">
		{@render children()}
	</main>

	<RonnieFloat />

	<footer class="border-t-[1.5px] border-inkline bg-surface">
		<div
			class="ron-mono mx-auto flex max-w-7xl flex-col gap-2 px-4 py-5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6"
		>
			<span>RON · Real or Not? — Everyday media trust platform</span>
			<span
				class="inline-flex w-fit items-center rounded-full bg-ink px-3 py-1 text-[11px] font-bold text-canvas"
				title="Open-weight attribution required by the Muse Model License"
			>
				Built with Muse Spark Open
			</span>
			<span>Meta AI Global Hackathon · Svelte 5 Runes + Convex + Rust WASM</span>
		</div>
	</footer>
</div>
