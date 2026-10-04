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
	let sourceError = $derived(connectionError || window.error);
	let ready = $derived(!sourceError && window.samples.length === ECG_SAMPLES);
	let newerData = $derived(!!analyzedWindow && (analyzedWindow.firstRecordId !== window.firstRecordId || analyzedWindow.lastRecordId !== window.lastRecordId || analyzedWindow.available !== window.available || analyzedWindow.rowCount !== window.rowCount));
	let stale = $derived(!!result && (busy || !!sourceError || !!error));
	let ranked = $derived([...scores].sort((a, b) => b.score - a.score));
	// 150 labels at once is a wall of numbers, so the list opens on the strongest few.
	const TOP = 5;
	let showAll = $state(false);
	let visible = $derived(showAll ? ranked : ranked.slice(0, TOP));
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
		<h2 id="ecg-title" class="display text-[28px] md:text-[32px]"><span class="text-lime">ECG</span> <span class="outline-text">check</span></h2>
	</div>
	<p class="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-muted">Press Analyze ECG and an AI model reads your last 10 seconds of heart signal and lists what it sees. It runs in your browser, so nothing is uploaded. It isn’t a medical diagnosis.</p>
	{#if sourceError}
		<p class="mt-5 flex gap-2 text-[16px] leading-relaxed" role="alert"><TriangleAlert class="mt-1 shrink-0 text-lime" size={18} />Couldn’t load the heart signal. {sourceError}</p>
	{:else if !ready}
		<div class="mt-6" role="status">
			<p class="text-[17px] font-semibold">{window.reason || 'Collecting 10 seconds of heart signal…'}</p>
			<p class="mt-2 text-[14px] text-muted">The Analyze ECG button appears once there are 10 clean seconds.</p>
			<div class="mt-3 h-2 max-w-md overflow-hidden bg-raised" aria-hidden="true"><div class="h-full bg-lime transition-[width] duration-500 ease-out" style:width={`${Math.min(window.available / ECG_SAMPLES, 1) * 100}%`}></div></div>
		</div>
	{:else}
		<div class="mt-5 flex flex-wrap items-center gap-3">
			<button class="btn btn-lime px-4" onclick={analyze} disabled={busy}>{busy ? 'Analyzing…' : result ? 'Analyze ECG again' : 'Analyze ECG'}</button>
			{#if busy}<button class="btn btn-line px-4" onclick={() => controller.cancel()}>Cancel</button>{/if}
			<span class="text-[14px] text-muted">The first run downloads a 123 MB model.</span>
		</div>
	{/if}
	{#if ready || busy || status}<p class="mt-4 text-[15px] leading-relaxed" role="status">{status || 'Ready to analyze.'}{progress !== undefined ? ` ${progress}%` : ''}</p>{/if}
	{#if progress !== undefined}<progress class="mt-2 h-2 w-full accent-lime" max="100" value={progress} aria-label="Model download progress"></progress>{/if}
	{#if error}<p class="mt-4 flex gap-2 text-[16px] leading-relaxed" role="alert"><TriangleAlert class="mt-1 shrink-0 text-lime" size={18} />{error}</p>{/if}
	{#if scores.length}
		<div class="mt-8 border-t border-rule pt-6">
			<h3 class="display text-[20px]">What the model sees</h3>
			<p class="mt-2 max-w-[62ch] text-[14px] leading-relaxed text-muted">Scores show how strongly each label matches. They aren’t probabilities or a diagnosis. Labels other than normal that score at least 80% also appear in Coach’s notes.</p>
			{#if stale}<p class="mt-3 text-[14px] text-lime">Couldn’t update. Showing the last result.</p>{/if}
			{#if newerData}<p class="mt-4 text-[15px] leading-relaxed">Newer heart signal is available. Press Analyze ECG again to update.</p>{/if}
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
			{#if ranked.length > TOP}
				<button class="btn btn-line mt-4" onclick={() => (showAll = !showAll)} aria-expanded={showAll}>{showAll ? `Show top ${TOP}` : `Show all ${ranked.length}`}</button>
			{/if}
		</div>
	{/if}

	<details class="mt-6 max-w-[70ch] text-[14px] leading-relaxed text-muted">
		<summary class="label flex min-h-11 items-center text-white">Technical details</summary>
		<p>Runs the single-lead ECGFounder model. ECG assumes lead I at {ECG_SAMPLE_RATE.toLocaleString('en-GB')} Hz ({ECG_SAMPLES / ECG_SAMPLE_RATE} seconds for {samples} samples). The database doesn’t store lead or sampling-rate metadata. Capture timing is checked; lead placement and sensor-specific accuracy remain unverified. Scores are independent, unvalidated model outputs requiring clinical context, not diagnoses or calibrated risk estimates.</p>
		<p class="mt-2">The latest database ECG values, including missing samples, are read in record order. Analysis requires {samples} finite values with consecutive record IDs, increasing capture times, no gaps over 2.5 ms, and an average rate within 20% of 2,000 Hz. Missing samples are never padded or filled in.</p>
		<p class="mt-2">Raw ECG is downsampled from {ECG_SAMPLE_RATE.toLocaleString('en-GB')} Hz to {ECG_MODEL_RATE} Hz using an 81-tap Kaiser anti-alias FIR filter (beta = 5, zero padding at the edges). At {ECG_MODEL_RATE} Hz it receives a 50 Hz notch (Q = 30), a fourth-order 0.67–40 Hz Butterworth bandpass, {ECG_BASELINE_SAMPLES}-sample median baseline removal, and standardization. Sigmoid is applied to each of the 150 outputs.</p>
		{#if result}<p class="mt-2 tabular-nums">Last analysis: records {analyzedWindow?.firstRecordId}–{analyzedWindow?.lastRecordId}, took {(elapsedMs / 1000).toFixed(2)} seconds.</p>{/if}
		<div class="mt-2 flex flex-wrap items-center gap-x-6">
			{#if result}<button class="inline-flex min-h-11 items-center gap-2 text-lime underline underline-offset-2" onclick={downloadResults}><Download size={16} />Download scores (JSON)</button>{/if}
			<a class="inline-flex min-h-11 items-center text-lime underline underline-offset-2" href={asset('models/ecgfounder/LICENSE')} download>ECGFounder MIT license</a>
		</div>
	</details>
</section>

<style>
	/* Score bars grow from the left when results arrive, top ranks first. */
	@media (prefers-reduced-motion: no-preference) {
		.grow-bar { transform-origin: left; animation: grow 700ms var(--ease-out-expo) calc(min(var(--rank), 10) * 40ms) backwards; }
	}
	@keyframes grow { from { scale: 0 1; } }
</style>
