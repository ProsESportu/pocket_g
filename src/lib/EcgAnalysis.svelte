<script lang="ts">
	import { onDestroy } from 'svelte';
	import { asset } from '$app/paths';
	import { Download, TriangleAlert } from '@lucide/svelte';
	import { ECG_SAMPLES, ECG_SAMPLE_RATE, ECG_BASELINE_SAMPLES, type EcgScore, type InferenceMessage } from './ecg.ts';
	import type { EcgWindow } from './ecg-database.ts';

	let { window, connectionError = '' }: { window: EcgWindow; connectionError?: string } = $props();
	let busy = $state(false);
	let status = $state('');
	let progress = $state<number | undefined>();
	let error = $state('');
	let scores = $state.raw<EcgScore[]>([]);
	let elapsedMs = $state(0);
	let search = $state('');
	let showAll = $state(false);
	let analyzedWindow = $state.raw<EcgWindow | null>(null);
	let worker: Worker | undefined;
	let sourceError = $derived(connectionError || window.error);
	let ready = $derived(!sourceError && window.samples.length === ECG_SAMPLES);
	let newerData = $derived(analyzedWindow && (analyzedWindow.firstRecordId !== window.firstRecordId || analyzedWindow.lastRecordId !== window.lastRecordId));
	let ranked = $derived([...scores].sort((a, b) => b.score - a.score));
	let matches = $derived(ranked.filter((row) => row.label.toLowerCase().includes(search.toLowerCase())));
	let visible = $derived(showAll || search ? matches : matches.slice(0, 10));
	onDestroy(() => worker?.terminate());

	function clearResults() {
		scores = [];
		error = '';
		search = '';
		showAll = false;
		progress = undefined;
		status = '';
	}
	function cancel() {
		worker?.terminate();
		worker = undefined;
		busy = false;
		progress = undefined;
		status = 'Analysis canceled. You can try again.';
	}
	function analyze() {
		if (busy || !ready) return;
		clearResults();
		busy = true;
		status = 'Preparing database ECG values…';
		analyzedWindow = { ...window, samples: [] };
		try {
			if (!worker) {
				worker = new Worker(new URL('./ecg.worker.ts', import.meta.url), { type: 'module' });
				worker.onmessage = (event: MessageEvent<InferenceMessage>) => {
					const message = event.data;
					if (message.type === 'status') { status = message.text; progress = message.progress; }
					else if (message.type === 'result') {
						scores = message.scores;
						elapsedMs = message.elapsedMs;
						busy = false;
						progress = undefined;
						status = 'Analysis complete. All 150 scores are available.';
					} else { error = message.text; busy = false; progress = undefined; status = 'Analysis failed.'; }
				};
				worker.onerror = () => {
					error = 'The browser could not run the ECG model. Try again in a current browser with WebAssembly support.';
					cancel();
					status = 'Analysis failed.';
				};
			}
			worker.postMessage({ samples: [...window.samples], modelUrl: new URL(asset('models/ecgfounder/1_lead_ECGFounder.onnx'), location.href).href, labelsUrl: new URL(asset('models/ecgfounder/tasks.txt'), location.href).href });
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Could not analyze the database ECG values.';
			busy = false;
			status = 'Analysis failed.';
		}
	}
	function downloadResults() {
		const report = { model: 'ECGFounder single-lead', source: 'public.ekgemgpuls.ekg', firstRecordId: analyzedWindow?.firstRecordId, lastRecordId: analyzedWindow?.lastRecordId, startedAt: analyzedWindow?.startedAt, endedAt: analyzedWindow?.endedAt, assumedSampleRate: ECG_SAMPLE_RATE, assumedLead: 'I', samples: ECG_SAMPLES, preprocessing: 'raw', inferenceMs: elapsedMs, scores };
		const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
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
		<p class="label text-muted tabular-nums">{window.available.toLocaleString('en-GB')} of 5,000 samples</p>
	</div>
	<p class="mt-3 max-w-[62ch] text-[16px] leading-relaxed text-muted">Runs the single-lead ECGFounder model on your latest 5,000 EKG samples. It runs in this browser, so the samples aren’t uploaded anywhere.</p>
	{#if sourceError}
		<p class="mt-5 flex gap-2 text-[16px] leading-relaxed" role="alert"><TriangleAlert class="mt-1 shrink-0 text-lime" size={18} />Could not load database ECG values. {sourceError}</p>
	{:else if !ready}
		<div class="mt-6" role="status">
			<p class="text-[17px] font-semibold">Needs 5,000 EKG samples. {window.available.toLocaleString('en-GB')} so far.</p>
			<div class="mt-3 h-2 max-w-md overflow-hidden bg-raised" aria-hidden="true"><div class="h-full bg-lime" style:width={`${Math.min(window.available / ECG_SAMPLES, 1) * 100}%`}></div></div>
			<p class="mt-2 text-[14px] text-muted">New readings are counted on every refresh.</p>
		</div>
	{:else}
		<p class="mt-5 text-[14px] text-muted tabular-nums">Uses records {window.firstRecordId}–{window.lastRecordId}, oldest first.</p>
		<div class="mt-3 flex flex-wrap items-center gap-3">
			<button class="btn btn-lime" onclick={analyze} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze ECG'}</button>
			{#if busy}<button class="btn btn-line" onclick={cancel}>Cancel</button>{/if}
			<span class="text-[14px] text-muted">The first run downloads a 118 MiB model.</span>
		</div>
		<p class="mt-4 text-[15px] leading-relaxed" role="status">{status || 'Ready to analyze.'}{progress !== undefined ? ` ${progress}%` : ''}</p>
	{/if}
	{#if progress !== undefined}<progress class="mt-2 h-2 w-full accent-lime" max="100" value={progress} aria-label="Model download progress"></progress>{/if}
	{#if error}<p class="mt-4 flex gap-2 text-[16px] leading-relaxed" role="alert"><TriangleAlert class="mt-1 shrink-0 text-lime" size={18} />{error}</p>{/if}
	{#if scores.length && ready}
		<div class="mt-8 border-t border-rule pt-6">
			<div class="flex flex-wrap items-end justify-between gap-4">
				<div>
					<h3 class="display text-[20px]">Model scores</h3>
					<p class="mt-2 text-[14px] text-muted tabular-nums">Records {analyzedWindow?.firstRecordId}–{analyzedWindow?.lastRecordId}. Inference took {(elapsedMs / 1000).toFixed(2)} seconds.</p>
				</div>
				<button class="btn btn-line" onclick={downloadResults}><Download size={18} />Download all scores</button>
			</div>
			{#if newerData}<p class="mt-4 text-[15px] leading-relaxed">Newer samples are available. Analyze ECG again to update these scores.</p>{/if}
			<label class="label mt-6 block max-w-sm text-muted">Find a label <input class="mt-2 block min-h-11 w-full border border-white/45 bg-night px-3 text-[16px] font-normal tracking-normal text-white normal-case placeholder:text-muted" type="search" placeholder="Search 150 labels" bind:value={search} /></label>
			<ol class="mt-4">
				{#each visible as row (row.index)}
					<li class="grid gap-2 border-b border-rule py-3 text-[15px] sm:grid-cols-[minmax(0,1fr)_15rem] sm:items-center sm:gap-6">
						<span class="[overflow-wrap:anywhere]">{row.label}</span>
						<span class="flex items-center gap-3">
							<span aria-hidden="true" class="h-2 flex-1 overflow-hidden bg-raised"><span class="block h-full bg-lime" style:width={`${row.score * 100}%`}></span></span>
							<strong class="w-16 text-right font-bold tabular-nums">{(row.score * 100).toFixed(2)}%</strong>
						</span>
					</li>
				{/each}
			</ol>
			{#if visible.length === 0}<p class="mt-4 text-[15px]">No labels match your search.</p>{/if}
			{#if !search}<button class="btn btn-line mt-4" onclick={() => showAll = !showAll}>{showAll ? 'Show top 10 scores' : 'Show all 150 scores'}</button>{/if}
		</div>
	{/if}
	<p class="mt-6 max-w-[70ch] text-[14px] leading-relaxed text-muted">ECG uses lead I at {ECG_SAMPLE_RATE} Hz ({ECG_SAMPLES / ECG_SAMPLE_RATE} seconds for 5,000 samples). The database doesn’t store lead or sampling-rate metadata. The model expects 500 Hz input; these samples aren’t resampled. Scores are independent model outputs, not diagnoses or calibrated risk estimates.</p>
	<details class="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
		<summary class="label flex min-h-11 items-center text-white">How the ECG is prepared</summary>
		<p>The latest nonempty database EKG values are read in record order. Analysis requires 5,000 finite values. No samples are padded or fabricated.</p>
		<p class="mt-2">Raw ECG is filtered at {ECG_SAMPLE_RATE} Hz with a 50 Hz notch (Q = 30), a fourth-order 0.67–40 Hz Butterworth bandpass, and a {ECG_BASELINE_SAMPLES}-sample median baseline removal, then standardized. Sigmoid is applied to each of the 150 outputs.</p>
		<a class="mt-2 inline-flex min-h-11 items-center text-lime underline underline-offset-2" href={asset('models/ecgfounder/LICENSE')} download>ECGFounder MIT license</a>
	</details>
</section>
