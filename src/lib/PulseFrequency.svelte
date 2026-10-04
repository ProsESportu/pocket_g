<script lang="ts">
	import { untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { TriangleAlert } from '@lucide/svelte';
	import { PULSE, pulseDisplay, type PulseResult } from './pulse';
	let { result, refreshError = '', refreshing = false, frequency = false }: { result: PulseResult; refreshError?: string; refreshing?: boolean; frequency?: boolean } = $props();
	// Props trigger display updates; this cache only remembers the preceding successful result.
	let previous: PulseResult | null = untrack(() => result.status === 'ready' && !refreshError ? result : null);
	let display = $derived(pulseDisplay(result, previous, refreshError));
	let rateFallback = $derived(result.timestampsInvalid || (!!display.failure && display.result.timestampsInvalid));
	// The page banner already reports connection failures, so only pulse-specific errors are repeated here.
	let ownFailure = $derived(display.failure && display.failure !== refreshError ? display.failure : '');
	let outage = $derived(!!refreshError && !display.stale);
	let timing = $derived(display.result.timing === 'timestamps' ? 'capture timestamps' : `a ${display.result.sampleRate ?? 'missing'} Hz sampling rate`);
	// Rolls to each new estimate, so a change between refreshes is visible.
	const bpm = Tween.of(() => display.result.bpm ?? 0, { duration: () => (prefersReducedMotion.current ? 0 : 600), easing: cubicOut });
	const uid = $props.id();

	// A successful result is displayed directly; only a later failed refresh reads this cache.
	$effect(() => {
		if (result.status !== 'error' && !refreshError) previous = result.status === 'ready' ? result : null;
	});
</script>

<section class="min-w-0" aria-labelledby={`${uid}-title`} aria-busy={refreshing}>
	<h2 id={`${uid}-title`} class="label text-muted">{frequency ? 'Estimated pulse frequency' : 'Estimated heart rate'}</h2>
	<div>
		{#if display.result.status === 'ready'}
			<p class="mt-2 flex items-baseline gap-3 leading-none">
				<span class="text-[clamp(72px,11vw,128px)] [font-weight:850] [font-stretch:112%] tracking-[-0.02em]">{frequency ? display.result.hz!.toFixed(2) : Math.round(display.result.bpm!)}</span>
				<span class="display text-[22px] text-lime">{frequency ? 'Hz' : 'BPM'}</span>
			</p>
			<p class="mt-4 max-w-[44ch] text-[15px] leading-relaxed text-muted">{frequency ? `${Math.round(display.result.bpm!)} BPM` : `${display.result.hz!.toFixed(2)} Hz`} from {display.result.beatCount} beats over {display.result.duration.toFixed(1)} seconds, timed by {timing}. Records {display.result.firstRecordId}–{display.result.lastRecordId}.</p>
		{:else if outage}
			<p class="mt-3 max-w-[30ch] text-[20px] leading-snug font-semibold">No {frequency ? 'pulse frequency' : 'heart rate'} while the connection is down.</p>
		{:else}
			<p class="mt-3 max-w-[30ch] text-[20px] leading-snug font-semibold">{display.result.reason}</p>
			{#if display.result.status !== 'unset'}<p class="mt-3 text-[15px] text-muted">{display.result.duration.toFixed(1)} seconds of pulse data, timed by {timing}.</p>{/if}
		{/if}
	</div>
	<div aria-live="polite">
		{#if display.stale || ownFailure}
			<p class="mt-3 flex gap-2 text-[15px] leading-relaxed"><TriangleAlert class="mt-0.5 shrink-0 text-lime" size={18} />{display.stale ? 'Showing the last successful estimate. ' : ''}{ownFailure}</p>
		{/if}
	</div>
	<p class="mt-3 max-w-[48ch] text-[13px] leading-relaxed text-muted">Uses up to 10 seconds of consecutive pulse samples. {rateFallback ? `Using the board’s ${PULSE.defaultSampleRate.toLocaleString('en-GB')} Hz while capture timestamps are invalid.` : 'Timing comes from the capture timestamps.'}</p>
</section>
