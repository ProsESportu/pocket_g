<script lang="ts">
	import { onDestroy } from 'svelte';
	import { asset } from '$app/paths';
	import { ECG_SAMPLES, type EcgScore, type InferenceMessage } from './ecg.ts';
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
		const report = { model: 'ECGFounder single-lead', source: 'public.ekgemgpuls.ekg', firstRecordId: analyzedWindow?.firstRecordId, lastRecordId: analyzedWindow?.lastRecordId, startedAt: analyzedWindow?.startedAt, endedAt: analyzedWindow?.endedAt, assumedSampleRate: 500, assumedLead: 'I', samples: ECG_SAMPLES, preprocessing: 'raw', inferenceMs: elapsedMs, scores };
		const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
		const link = document.createElement('a');
		link.href = url;
		link.download = 'ecgfounder-results.json';
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
</script>

<section class="ecg-panel" aria-labelledby="ecg-title" aria-busy={busy}>
	<div class="ecg-heading">
		<div><p class="eyebrow">DATABASE ECG ANALYSIS</p><h2 id="ecg-title">ECGFounder <span class="badge">Single lead · 150 labels</span></h2><p>Analyze the latest 5,000 ECG values from your database in this browser.</p></div>
		<span class="ecg-local">{window.available.toLocaleString('en-GB')} / 5,000 samples</span>
	</div>
	{#if sourceError}
		<p class="error" role="alert">Could not load database ECG values. {sourceError}</p>
	{:else if !ready}
		<p class="ecg-insufficient" role="status">Not enough ECG data. Analysis needs 5,000 usable samples; the database has {window.available.toLocaleString('en-GB')} available. New readings are checked when the dashboard refreshes.</p>
	{:else}
		<p class="ecg-source">Source: public.ekgemgpuls · EKG · records #{window.firstRecordId}–#{window.lastRecordId}, oldest to newest.</p>
		<div class="ecg-actions"><button class="ecg-primary" onclick={analyze} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze ECG'}</button>{#if busy}<button class="ecg-secondary" onclick={cancel}>Cancel</button>{/if}<span>First analysis downloads the 118 MiB model.</span></div>
		<p class="ecg-status" role="status">{status || 'Ready to analyze database ECG.'}{progress !== undefined ? ` ${progress}%` : ''}</p>
	{/if}
	{#if progress !== undefined}<progress max="100" value={progress} aria-label="Model download progress"></progress>{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if scores.length && ready}
		<div class="ecg-results-heading"><div><h3>Model scores</h3><p>Records #{analyzedWindow?.firstRecordId}–#{analyzedWindow?.lastRecordId} · {(elapsedMs / 1000).toFixed(2)} s inference</p></div><button class="ecg-secondary" onclick={downloadResults}>Download all scores</button></div>
		{#if newerData}<p class="ecg-status">New database samples are available. Analyze ECG again to update these results.</p>{/if}
		<label class="ecg-search">Find a label <input type="search" placeholder="Search 150 labels…" bind:value={search} /></label>
		<ol class="ecg-scores">{#each visible as row (row.index)}<li><span>{row.label}</span><div><meter min="0" max="1" value={row.score} aria-label={`${row.label} model score`}></meter><strong>{(row.score * 100).toFixed(2)}%</strong></div></li>{/each}</ol>
		{#if visible.length === 0}<p class="ecg-status">No labels match your search.</p>{/if}
		{#if !search}<button class="ecg-secondary" onclick={() => showAll = !showAll}>{showAll ? 'Show top 10 scores' : 'Show all 150 scores'}</button>{/if}
	{/if}
	<p class="ecg-note">The model assumes lead I recorded at 500 Hz. The database does not store lead or sampling-rate metadata. Scores are independent model outputs, not diagnoses or calibrated risk estimates.</p>
	<details><summary>ECG preprocessing</summary><p>The latest nonempty database EKG values are read in record order. Analysis requires 5,000 finite values. No samples are padded or fabricated.</p><p>Raw ECG is filtered with a 50 Hz notch (Q = 30), a fourth-order 0.67–40 Hz Butterworth bandpass, and a 201-sample median baseline removal, then standardized. Sigmoid is applied to each of the 150 outputs.</p><a href={asset('models/ecgfounder/LICENSE')} download>ECGFounder MIT license</a></details>
</section>

<style>
	.ecg-panel { margin: 0 0 32px; padding: 24px; background: white; border: 1px solid #d9eade; border-radius: 12px; }
	.ecg-heading, .ecg-results-heading { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
	.ecg-heading p:not(.eyebrow), .ecg-results-heading p { font-size: 12px; color: #6d8074; line-height: 1.6; }
	.ecg-local { font-size: 12px; color: #29815c; white-space: nowrap; }
	.ecg-search { display: flex; flex-direction: column; gap: 9px; font-size: 12px; font-weight: 600; }
	.ecg-search input { width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid #dbe5df; border-radius: 8px; background: #f7f9f8; color: #243b35; font: inherit; }
	.ecg-actions > span { color: #6d8074; font-size: 11px; font-weight: 400; line-height: 1.6; }
	.ecg-source { font-size: 12px; color: #587062; overflow-wrap: anywhere; }
	.ecg-insufficient { background: #edf6f1; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.7; }
	.ecg-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
	.ecg-primary, .ecg-secondary { border: 1px solid #dbe5df; border-radius: 8px; padding: 11px 16px; font-size: 12px; }
	.ecg-primary { background: #29815c; color: white; border-color: #29815c; }
	.ecg-secondary { background: white; color: #3d594b; }
	.ecg-status { font-size: 12px; color: #587062; line-height: 1.6; }
	progress { width: 100%; accent-color: #29815c; }
	.ecg-results-heading { padding-top: 20px; margin-top: 20px; border-top: 1px solid #e3e9e6; }
	h3 { margin: 0; font-size: 14px; }
	.ecg-search { max-width: 340px; margin-block: 12px; }
	.ecg-scores { padding: 0; margin: 16px 0; list-style: none; }
	.ecg-scores li { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 20px; padding: 12px 0; border-bottom: 1px solid #edf1ee; font-size: 12px; }
	.ecg-scores li > span { overflow-wrap: anywhere; }
	.ecg-scores li > div { display: flex; align-items: center; gap: 12px; }
	meter { width: 110px; height: 10px; }
	.ecg-scores strong { width: 65px; text-align: right; font-variant-numeric: tabular-nums; font-size: 12px; }
	.ecg-note, details { color: #6d8074; font-size: 11px; line-height: 1.7; }
	.ecg-note { margin: 20px 0 12px; }
	summary { cursor: pointer; color: #3d594b; }
	details a { color: #29815c; }
	@media (max-width: 700px) { .ecg-heading, .ecg-results-heading { align-items: flex-start; flex-direction: column; } .ecg-scores li { grid-template-columns: 1fr; gap: 8px; } .ecg-panel { padding: 20px; } }
</style>
