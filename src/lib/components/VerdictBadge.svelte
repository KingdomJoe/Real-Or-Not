<script lang="ts">
	import { VERDICT_META, type VerdictKey } from '#lib/types/ron';

	interface Props {
		verdict: VerdictKey;
		size?: 'sm' | 'md' | 'lg';
		showKaomoji?: boolean;
		showDot?: boolean;
	}

	let { verdict, size = 'md', showKaomoji = true, showDot = false }: Props = $props();

	const meta = $derived(VERDICT_META[verdict]);

	const sizeClass = $derived(
		size === 'sm'
			? 'px-2.5 py-1 text-xs gap-1.5'
			: size === 'lg'
				? 'px-5 py-2.5 text-base gap-2.5'
				: 'px-3.5 py-1.5 text-sm gap-2'
	);
</script>

<span
	class="ron-btn-hard inline-flex items-center rounded-full font-display font-bold text-white {sizeClass}"
	style="background-color: {meta.color};"
	role="status"
	aria-label="Verdict: {meta.label}"
>
	{#if showDot}<span aria-hidden="true">{meta.dot}</span>{/if}
	{#if showKaomoji}<span class="kaomoji" aria-hidden="true">{meta.kaomoji}</span>{/if}
	<span>{meta.label}</span>
</span>
