<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { untrack } from 'svelte';
	import { pulseDisplay, validPulseRate, type PulseResult } from './pulse';
	let { result, refreshError = '', refreshing = false }: { result: PulseResult; refreshError?: string; refreshing?: boolean } = $props();
	let rateInput = $state<number | undefined>(untrack(() => result.sampleRate ?? undefined));
	let applying = $state(false);
	let inputError = $state('');
	let previous = $state<PulseResult | null>(untrack(() => result.status === 'ready' && !refreshError ? result : null));
	let display = $derived(pulseDisplay(result, previous, refreshError));
	let appliedRate = $derived(result.sampleRate);
	let showRatePicker = $derived(result.timestampsInvalid || (!!display.failure && display.result.timestampsInvalid));
	const uid = $props.id();

	$effect(() => {
		rateInput = appliedRate ?? undefined;
	});
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

<article class="pulse-frequency" aria-labelledby={`${uid}-title`} aria-busy={applying || refreshing}>
	<h3 id={`${uid}-title`}>Pulse frequency <span class="badge">Estimate</span></h3>
	{#if showRatePicker}
	<p class="pulse-warning">{result.timingReason || display.result.timingReason} Use the sensor’s sampling rate instead.</p>
	<form class="pulse-rate-form" onsubmitcapture={applyRate}>
		<label for={`${uid}-rate`}>Sampling rate (Hz)</label>
		<div class="pulse-rate-controls">
			<input id={`${uid}-rate`} name="pulseSampleRate" type="number" min="10" max="1000" step="any" required bind:value={rateInput} aria-describedby={`${uid}-help ${uid}-input-error`} aria-invalid={!!inputError} disabled={applying} />
			<button type="submit" disabled={applying || refreshing}>{applying ? 'Applying…' : 'Apply'}</button>
		</div>
		<p id={`${uid}-input-error`} class="pulse-warning" role="alert">{inputError}</p>
	</form>
	{/if}
	<div class="pulse-result" aria-live="polite" aria-atomic="true">
		{#if display.result.status === 'ready'}
			<div class="pulse-bpm">{Math.round(display.result.bpm!)} <span>BPM</span></div>
			<p class="pulse-hz">{display.result.hz!.toFixed(2)} Hz</p>
			<p>{display.result.duration.toFixed(1)} seconds · {display.result.timing === 'timestamps' ? 'created_at timing' : `${display.result.sampleRate} Hz sampling`} · {display.result.beatCount} beats</p>
			<p>Records #{display.result.firstRecordId}–#{display.result.lastRecordId}</p>
		{:else}
			<p class="pulse-unavailable">{display.result.reason}</p>
			{#if display.result.status !== 'unset'}<p>{display.result.duration.toFixed(1)} seconds available · {display.result.timing === 'timestamps' ? 'created_at timing' : `${display.result.sampleRate ?? 'Unset'} Hz sampling`}</p>{/if}
		{/if}
		{#if display.failure}<p class="pulse-warning">{display.stale ? 'Stale estimate — showing the last successful result. ' : ''}{display.failure}</p>{/if}
	</div>
	<p id={`${uid}-help`} class="pulse-help">The estimate uses up to 10 seconds of consecutive samples. {showRatePicker ? 'Use the sensor’s actual sampling rate when capture timestamps are invalid.' : 'Timing comes from the created_at capture timestamps.'}</p>
</article>
