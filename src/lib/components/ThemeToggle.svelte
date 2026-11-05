<script lang="ts">
	import { mode, toggleMode } from 'mode-watcher';
	import { Moon, Sun } from '@lucide/svelte';

	interface Props {
		compact?: boolean;
	}

	let { compact = false }: Props = $props();
</script>

<button
	type="button"
	onclick={toggleMode}
	class="ron-btn-hard inline-flex items-center gap-2 rounded-full bg-surface font-display font-semibold text-ink {compact
		? 'h-9 w-9 justify-center p-0'
		: 'px-4 py-2 text-sm'}"
	aria-label={mode.current === 'dark' ? 'Switch to Daylight Trust (light mode)' : 'Switch to Forensic Darkroom (dark mode)'}
	title={mode.current === 'dark' ? 'Daylight Trust ☀️' : 'Forensic Darkroom 🌙'}
>
	{#if mode.current === 'dark'}
		<Sun class="h-4 w-4" strokeWidth={2.25} />
		{#if !compact}<span>Daylight</span>{/if}
	{:else}
		<Moon class="h-4 w-4" strokeWidth={2.25} />
		{#if !compact}<span>Darkroom</span>{/if}
	{/if}
</button>
