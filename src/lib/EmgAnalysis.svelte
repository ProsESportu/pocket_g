<script lang="ts">
	import { onDestroy } from 'svelte';
	import { asset } from '$app/paths';
	import * as env from '$app/env/public';
	import { Download } from '@lucide/svelte';
	import { EMG, serializeEmgResult, type EmgResult } from './emg.ts';
	import { loadDatabaseEmg } from './emg-readings.ts';
	import { EmgAnalysisController, initialEmgAnalysisState } from './emg-analysis.ts';
	import RepConsistency from './RepConsistency.svelte';

	let { throughId, connectionError = '', onresult, onstate = () => {} }: {
		throughId?: number; connectionError?: string;
		onresult: (result: EmgResult) => void; onstate?: (state: { busy: boolean; error: string }) => void;
	} = $props();
	let analysis = $state.raw(initialEmgAnalysisState());
	let result = $derived(analysis.result);
	let sourceError = $derived(connectionError || (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ? 'Configure the Supabase URL and publishable key to analyze EMG.' : ''));
	let newerData = $derived(result && throughId !== undefined && result.window.lastRecordId !== null && throughId > result.window.lastRecordId);
	let stale = $derived(!!result && (analysis.busy || !!sourceError || !!analysis.error));
	// Runs only when the button is pressed, up to the newest record shown at that moment.
	const controller = new EmgAnalysisController({
		load: (id, signal) => loadDatabaseEmg(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, id, signal),
		worker: () => new Worker(new URL('./emg.worker.ts', import.meta.url), { type: 'module' }),
		urls: () => ({
			modelUrl: new URL(asset('models/emg-fatigue/fatigue.onnx'), location.href).href,
			metadataUrl: new URL(asset('models/emg-fatigue/metadata.json'), location.href).href,
			profileUrl: new URL(asset('models/emg-fatigue/upstream-2000hz.json'), location.href).href
		}),
		change: (next) => { analysis = next; onstate(next); },
		complete: (next) => onresult(next)
	});
	onDestroy(() => controller.dispose());
	const time = (value: string) => Number.isFinite(Date.parse(value))
		? new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value)) : 'Timestamp unavailable';

	function download() {
		if (!result) return;
		const url = URL.createObjectURL(new Blob([serializeEmgResult(result)], { type: 'application/json' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'emg-fatigue-results.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<!-- Same panel as the ECG check: bordered box with the lime wedge along the bottom edge. -->
<section class="relative min-w-0 overflow-hidden border border-rule bg-night p-5 pb-12 md:p-8 md:pb-14" aria-labelledby="emg-analysis-title" aria-busy={analysis.busy}>
	<span aria-hidden="true" class="wedge bottom-0 left-0 h-3 w-44"></span>
	<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
		<h2 id="emg-analysis-title" class="display text-[28px] md:text-[32px]"><span class="text-lime">EMG</span> <span class="outline-text">fatigue</span></h2>
	</div>
	<p class="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-muted">After a set, press Analyze EMG. An AI model checks up to the last minute of muscle signal and marks the rep where it thinks your muscle started to tire. It needs at least 10 seconds and 3 reps.</p>
	<p class="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-muted">It finds reps from the muscle signal, so its count can differ from Your reps.</p>
	<div class="mt-5 flex flex-wrap gap-3">
		{#if analysis.busy}
			<button class="btn btn-line px-4" onclick={() => controller.cancel()}>Cancel EMG analysis</button>
		{:else}
			<button class="btn btn-lime px-4" disabled={!!sourceError || throughId === undefined} onclick={() => controller.analyze(throughId)}>{analysis.error ? 'Retry EMG analysis' : result ? 'Analyze EMG again' : 'Analyze EMG'}</button>
		{/if}
	</div>
	<p class="mt-3 text-[14px] text-muted" role="status">{analysis.status || (throughId === undefined ? 'Waiting for readings.' : 'Ready to analyze.')}</p>
	{#if sourceError || analysis.error}<p class="mt-3 border-l-2 border-lime bg-raised px-4 py-3 text-[15px]" role="alert">{sourceError || analysis.error} {result ? 'The last result is still shown below.' : ''}</p>{/if}
	{#if result}
		<div class="mt-8 border-t border-rule pt-6">
			<p class="label text-lime">{result.status === 'ready' ? 'Last analysis' : 'Couldn’t analyze'}</p>
			<p class="mt-2 text-[14px] leading-relaxed text-muted tabular-nums">{result.window.duration.toFixed(1)} seconds of muscle signal</p>
			{#if stale}<p class="mt-3 text-[14px] text-lime">Couldn’t update. Showing the last result.</p>{/if}
			{#if newerData}<p class="mt-3 text-[14px] text-lime">Newer readings are available. Press Analyze EMG again to update.</p>{/if}
			{#if result.status === 'unavailable'}
				<p class="mt-4 text-[15px]">{result.reason}</p>
			{:else}
				<p class="display mt-5 text-[22px]">{result.rows.length} reps found</p>
				<p class="mt-2 text-[16px]">{result.triggerRep === null ? 'No fatigue flagged in these reps.' : `Fatigue flagged at rep ${result.triggerRep}.`}</p>
				<p class="mt-2 text-[13px] text-muted">Flagged when 2 of the last 3 reps score 58% or more.</p>
				<RepConsistency rows={result.rows} />
				<div class="mt-4 overflow-x-auto">
					<table class="w-full text-left text-[14px] tabular-nums">
						<caption class="sr-only">Experimental fatigue scores by rep, unvalidated for this sensor</caption>
						<thead class="label text-lime"><tr class="border-b border-rule"><th scope="col" class="py-2 pr-4">Rep</th><th scope="col" class="py-2 pr-4">Time (s)</th><th scope="col" class="py-2 pr-4">Score</th><th scope="col" class="py-2">≥ 58%</th></tr></thead>
						<tbody>{#each result.rows as row (row.rep)}<tr class="border-b border-rule"><th scope="row" class="py-2 pr-4 font-semibold">{row.rep}</th><td class="py-2 pr-4">{row.peak_time.toFixed(2)}</td><td class="py-2 pr-4">{(row.proba * 100).toFixed(1)}%</td><td class="py-2">{row.pred ? 'Yes' : 'No'}</td></tr>{/each}</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
	<details class="mt-6 max-w-[70ch] text-[14px] leading-relaxed text-muted">
		<summary class="label flex min-h-11 items-center text-white">Technical details</summary>
		<p>Analyzes up to 60 continuous seconds of raw EMG with the original 20–450 Hz filter profile at {EMG.sampleRate.toLocaleString('en-GB')} Hz. Fatigue scores remain unvalidated for this sensor and exercise.</p>
		<p class="mt-2">Each analysis is a snapshot of a moving window, so rep numbering and the first-three-rep baseline restart every time.</p>
		{#if result}
			<p class="mt-2 tabular-nums">Last analysis: {result.window.sampleCount.toLocaleString('en-GB')} samples{#if result.window.firstRecordId !== null}, records {result.window.firstRecordId}–{result.window.lastRecordId}, {time(result.window.startedAt)} – {time(result.window.endedAt)}{/if}{#if result.status === 'ready'}, took {(result.elapsedMs / 1000).toFixed(2)} seconds{/if}.</p>
			<button class="mt-1 inline-flex min-h-11 items-center gap-2 text-lime underline underline-offset-2" onclick={download}><Download size={16} />Download results (JSON)</button>
		{/if}
	</details>
</section>
