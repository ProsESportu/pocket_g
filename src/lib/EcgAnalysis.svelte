<script lang="ts">
	import { onDestroy } from 'svelte';
	import { asset } from '$app/paths';
	import { Download, TriangleAlert } from '@lucide/svelte';
	import { ECG_SAMPLES, ECG_SAMPLE_RATE, ECG_MODEL_RATE, ECG_BASELINE_SAMPLES, serializeEcgResult, type EcgResult } from './ecg.ts';
	import type { EcgWindow } from './ecg-database.ts';
	import { EcgAnalysisController, initialEcgAnalysisState } from './ecg-analysis.ts';

	let { window, connectionError = '', onresult, onstate = () => {} }: {
		window: EcgWindow; connectionError?: string;
		onresult: (result: EcgResult) => void; onstate?: (state: { busy: boolean; error: string }) => void;
	} = $props();
	let analysis = $state.raw(initialEcgAnalysisState());
	let result = $derived(analysis.result);
	let busy = $derived(analysis.busy);
	let status = $derived(analysis.status);
	let progress = $derived(analysis.progress);
	let error = $derived(analysis.error);
	let scores = $derived(result?.scores ?? []);
	let elapsedMs = $derived(result?.elapsedMs ?? 0);
	let analyzedWindow = $derived(result?.window);
	let search = $state('');
	let showAll = $state(false);
	let sourceError = $derived(connectionError || window.error);
	let ready = $derived(!sourceError && window.samples.length === ECG_SAMPLES);
	let newerData = $derived(!!analyzedWindow && (analyzedWindow.firstRecordId !== window.firstRecordId || analyzedWindow.lastRecordId !== window.lastRecordId || analyzedWindow.available !== window.available || analyzedWindow.rowCount !== window.rowCount));
	let stale = $derived(!!result && (busy || !!sourceError || !!error));
	let ranked = $derived([...scores].sort((a, b) => b.score - a.score));
	let matches = $derived(ranked.filter((row) => row.label.toLowerCase().includes(search.toLowerCase())));
	let visible = $derived(showAll || search ? matches : matches.slice(0, 10));
	const samples = ECG_SAMPLES.toLocaleString('en-GB');
	// Runs only when the button is pressed, on the snapshot shown at that moment.
	const controller = new EcgAnalysisController({
		worker: () => new Worker(new URL('./ecg.worker.ts', import.meta.url), { type: 'module' }),
		urls: () => ({
			modelUrl: new URL(asset('models/ecgfounder/1_lead_ECGFounder.onnx'), location.href).href,
			labelsUrl: new URL(asset('models/ecgfounder/tasks.txt'), location.href).href
		}),
		change: (next) => { analysis = next; onstate(next); },
		complete: (next) => onresult(next)
	});
	onDestroy(() => controller.dispose());
	function analyze() {
		search = '';
		showAll = false;
		controller.analyze(window);
	}

	function downloadResults() {
		if (!result) return;
		const url = URL.createObjectURL(new Blob([serializeEcgResult(result)], { type: 'application/json' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'ecgfounder-results.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<section class="relative min-w-0 overflow-hidden border border-rule bg-night p-5 pb-12 md:p-8 md:pb-14" aria-labelledby="ecg-title" aria-busy={busy}>
	<span aria-hidden="true" class="wedge bottom-0 left-0 h-3 w-44"></span>
	<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
		<h2 id="ecg-title" class="display text-[28px] md:text-[32px]"><span class="text-lime">ECG model</span> <span class="outline-text">check</span></h2>
		<p class="label text-muted tabular-nums">{window.available.toLocaleString('en-GB')} of {samples} samples</p>
	</div>
	<p class="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-muted">Runs the single-lead ECGFounder model on your latest 10 seconds of EKG when you press Analyze ECG. It runs in this browser, so the samples aren’t uploaded anywhere.</p>
	{#if sourceError}
		<p class="mt-5 flex gap-2 text-[16px] leading-relaxed" role="alert"><TriangleAlert class="mt-1 shrink-0 text-lime" size={18} />Could not load database ECG values. {sourceError}</p>
	{:else if !ready}
		<div class="mt-6" role="status">
			<p class="text-[17px] font-semibold">{window.reason || `Needs ${samples} EKG samples (10 seconds). ${window.available.toLocaleString('en-GB')} so far.`}</p>
			<div class="mt-3 h-2 max-w-md overflow-hidden bg-raised" aria-hidden="true"><div class="h-full bg-lime transition-[width] duration-500 ease-out" style:width={`${Math.min(window.available / ECG_SAMPLES, 1) * 100}%`}></div></div>
			<p class="mt-2 text-[14px] text-muted">New readings are counted on every refresh.</p>
		</div>
	{:else}
		<p class="mt-5 text-[14px] text-muted tabular-nums">Uses records {window.firstRecordId}–{window.lastRecordId}, oldest first.</p>
		<div class="mt-3 flex flex-wrap items-center gap-3">
			<button class="btn btn-lime px-4" onclick={analyze} disabled={busy}>{busy ? 'Analyzing…' : result ? 'Analyze ECG again' : 'Analyze ECG'}</button>
			{#if busy}<button class="btn btn-line px-4" onclick={() => controller.cancel()}>Cancel</button>{/if}
			<span class="text-[14px] text-muted">The first run downloads a 118 MiB model.</span>
		</div>
	{/if}
	{#if ready || busy || status}<p class="mt-4 text-[15px] leading-relaxed" role="status">{status || 'Ready to analyze.'}{progress !== undefined ? ` ${progress}%` : ''}</p>{/if}
	{#if progress !== undefined}<progress class="mt-2 h-2 w-full accent-lime" max="100" value={progress} aria-label="Model download progress"></progress>{/if}
	{#if error}<p class="mt-4 flex gap-2 text-[16px] leading-relaxed" role="alert"><TriangleAlert class="mt-1 shrink-0 text-lime" size={18} />{error}</p>{/if}
	{#if scores.length}
		<div class="mt-8 border-t border-rule pt-6">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h3 class="display text-[20px]">Model scores</h3>
					<p class="mt-2 text-[14px] text-muted tabular-nums">Records {analyzedWindow?.firstRecordId}–{analyzedWindow?.lastRecordId}. Inference took {(elapsedMs / 1000).toFixed(2)} seconds.</p>
				</div>
				<button class="btn btn-line" onclick={downloadResults}><Download size={18} />Download all scores</button>
			</div>
			{#if stale}<p class="mt-3 text-[14px] text-lime">Stale snapshot. Showing the previous completed analysis.</p>{/if}
			{#if newerData}<p class="mt-4 text-[15px] leading-relaxed">Newer samples are available. Press Analyze ECG again to update these scores.</p>{/if}
			<label class="label mt-6 block max-w-sm text-muted">Find a label <input class="mt-2 block min-h-11 w-full border border-white/45 bg-night px-3 text-[16px] font-normal tracking-normal text-white normal-case placeholder:text-muted" type="search" placeholder="Search 150 labels" bind:value={search} /></label>
			<ol class="mt-4">
				{#each visible as row, rank (row.index)}
					<li class="grid gap-2 border-b border-rule py-3 text-[15px] sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center sm:gap-6">
						<span class="[overflow-wrap:anywhere]">{row.label}</span>
						<span class="flex items-center gap-3">
							<span aria-hidden="true" class="h-2 flex-1 overflow-hidden bg-raised"><span class="grow-bar block h-full bg-lime" style:width={`${row.score * 100}%`} style:--rank={rank}></span></span>
							<strong class="w-16 text-right font-bold tabular-nums">{(row.score * 100).toFixed(2)}%</strong>
						</span>
					</li>
				{/each}
			</ol>
			{#if visible.length === 0}<p class="mt-4 text-[15px]">No labels match your search.</p>{/if}
			{#if !search}<button class="btn btn-line mt-4" onclick={() => showAll = !showAll}>{showAll ? 'Show top 10 scores' : 'Show all 150 scores'}</button>{/if}
		</div>
	{/if}
	<p class="mt-6 max-w-[70ch] text-[14px] leading-relaxed text-muted">ECG assumes lead I at {ECG_SAMPLE_RATE.toLocaleString('en-GB')} Hz ({ECG_SAMPLES / ECG_SAMPLE_RATE} seconds for {samples} samples). The database doesn’t store lead or sampling-rate metadata. The model expects {ECG_MODEL_RATE} Hz input, so this browser applies an anti-alias filter and downsamples by {ECG_SAMPLE_RATE / ECG_MODEL_RATE}. Capture timing is checked; lead placement and sensor-specific accuracy remain unverified. Every non-normal label scoring at least 80% appears in coach’s notes. Scores are independent, unvalidated model outputs requiring clinical context, not diagnoses or calibrated risk estimates.</p>
	<details class="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
		<summary class="label flex min-h-11 items-center text-white">How the ECG is prepared</summary>
		<p>The latest database EKG values, including missing samples, are read in record order. Analysis requires {samples} finite values with consecutive record IDs, increasing capture times, no gaps over 2.5 ms, and an average rate within 20% of 2,000 Hz. Missing samples are never padded or filled in.</p>
		<p class="mt-2">Raw ECG is downsampled from {ECG_SAMPLE_RATE.toLocaleString('en-GB')} Hz to {ECG_MODEL_RATE} Hz using an 81-tap Kaiser anti-alias FIR filter (beta = 5, zero padding at the edges). At {ECG_MODEL_RATE} Hz it receives a 50 Hz notch (Q = 30), a fourth-order 0.67–40 Hz Butterworth bandpass, {ECG_BASELINE_SAMPLES}-sample median baseline removal, and standardization. Sigmoid is applied to each of the 150 outputs.</p>
		<a class="mt-2 inline-flex min-h-11 items-center text-lime underline underline-offset-2" href={asset('models/ecgfounder/LICENSE')} download>ECGFounder MIT license</a>
	</details>
</section>

<style>
	/* Score bars grow from the left when results arrive, top ranks first. */
	@media (prefers-reduced-motion: no-preference) {
		.grow-bar { transform-origin: left; animation: grow 700ms var(--ease-out-expo) calc(min(var(--rank), 10) * 40ms) backwards; }
	}
	@keyframes grow { from { scale: 0 1; } }
</style>
