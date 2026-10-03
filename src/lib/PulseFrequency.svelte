<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { TriangleAlert } from '@lucide/svelte';
	import { pulseDisplay, validPulseRate, type PulseResult } from './pulse';
	let { result, refreshError = '', refreshing = false, frequency = false }: { result: PulseResult; refreshError?: string; refreshing?: boolean; frequency?: boolean } = $props();
	// Resets to the applied rate whenever the server reports a new one; editable in between.
	let rateInput = $derived<number | undefined>(result.sampleRate ?? undefined);
	let applying = $state(false);
	let inputError = $state('');
	// Props trigger display updates; this cache only remembers the preceding successful result.
	let previous: PulseResult | null = untrack(() => result.status === 'ready' && !refreshError ? result : null);
	let display = $derived(pulseDisplay(result, previous, refreshError));
	let showRatePicker = $derived(result.timestampsInvalid || (!!display.failure && display.result.timestampsInvalid));
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

	async function applyRate(event: SubmitEvent) {
		event.preventDefault();
		const rate = rateInput;
		if (rate === undefined || !validPulseRate(rate)) {
			inputError = 'Enter a sampling rate from 10 to 1,000 Hz.';
			return;
		}
		applying = true;
		inputError = '';
		try {
			const url = new URL(page.url.href);
			url.searchParams.set('pulseSampleRate', String(rate));
			await goto(url, { reset: false, refreshAll: true });
		} catch {
			inputError = 'Could not apply the sampling rate. Please try again.';
		} finally { applying = false; }
	}
</script>

<section class="min-w-0" aria-labelledby={`${uid}-title`} aria-busy={applying || refreshing}>
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
	{#if showRatePicker}
		<form class="mt-4" onsubmitcapture={applyRate}>
			<p class="mb-3 flex gap-2 text-[15px] leading-relaxed"><TriangleAlert class="mt-0.5 shrink-0 text-lime" size={18} />{result.timingReason || display.result.timingReason} Use the sensor’s sampling rate instead.</p>
			<label for={`${uid}-rate`} class="label block text-muted">Sampling rate (Hz)</label>
			<div class="mt-2 flex gap-2">
				<input id={`${uid}-rate`} class="min-h-11 w-full min-w-0 border border-white/45 bg-night px-3 text-[16px] text-white tabular-nums" name="pulseSampleRate" type="number" min="10" max="1000" step="any" required bind:value={rateInput} aria-describedby={`${uid}-help ${uid}-input-error`} aria-invalid={!!inputError} disabled={applying} />
				<button class="btn btn-lime" type="submit" disabled={applying || refreshing}>{applying ? 'Applying…' : 'Apply'}</button>
			</div>
			<p id={`${uid}-input-error`} class="mt-2 text-[14px] text-lime" role="alert">{inputError}</p>
		</form>
	{/if}
	<p id={`${uid}-help`} class="mt-3 max-w-[48ch] text-[13px] leading-relaxed text-muted">Uses up to 10 seconds of consecutive pulse samples. {showRatePicker ? 'Enter the sensor’s real sampling rate while capture timestamps are invalid.' : 'Timing comes from the capture timestamps.'}</p>
</section>
