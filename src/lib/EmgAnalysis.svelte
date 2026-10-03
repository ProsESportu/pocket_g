<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { asset } from '$app/paths';
	import * as env from '$app/env/public';
	import { Download } from '@lucide/svelte';
	import { EMG, serializeEmgResult, type EmgResult } from './emg.ts';
	import { loadDatabaseEmg } from './emg-readings.ts';
	import { EmgAnalysisController, initialEmgAnalysisState } from './emg-analysis.ts';
	import { AnalysisMonitor } from './analysis-monitor.ts';
	import RepConsistency from './RepConsistency.svelte';

	let { throughId, connectionError = '', monitoring = true, refreshing = false, manualRequest = 0, onresult, onstate = () => {} }: {
		throughId?: number; connectionError?: string; monitoring?: boolean; refreshing?: boolean; manualRequest?: number;
		onresult: (result: EmgResult) => void; onstate?: (state: { busy: boolean; error: string }) => void;
	} = $props();
	let analysis = $state.raw(initialEmgAnalysisState());
	let result = $derived(analysis.result);
	let sourceError = $derived(connectionError || (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ? 'Configure the Supabase URL and publishable key to analyze EMG.' : ''));
	let newerData = $derived(result && throughId !== undefined && result.window.lastRecordId !== null && throughId > result.window.lastRecordId);
	let stale = $derived(!!result && (analysis.busy || !!sourceError || !!analysis.error || !!newerData));
	const monitor = new AnalysisMonitor<{ throughId?: number }>({ run: (snapshot) => { void controller.analyze(snapshot.throughId); } });
	const controller = new EmgAnalysisController({
		load: (id, signal) => loadDatabaseEmg(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, id, signal),
		worker: () => new Worker(new URL('./emg.worker.ts', import.meta.url), { type: 'module' }),
		urls: () => ({
			modelUrl: new URL(asset('models/emg-fatigue/fatigue.onnx'), location.href).href,
			metadataUrl: new URL(asset('models/emg-fatigue/metadata.json'), location.href).href,
			profileUrl: new URL(asset('models/emg-fatigue/experimental-125hz.json'), location.href).href
		}),
		change: (next) => { analysis = next; onstate(next); },
		complete: (next) => onresult(next),
		settled: (success) => monitor.complete(success)
	});
	function updateMonitoring() {
		const snapshot = sourceError || refreshing ? null : { throughId };
		const key = String(throughId);
		const enabled = monitoring;
		const request = manualRequest;
		untrack(() => monitor.observe({ snapshot, key, enabled, manualRequest: request }));
	}
	$effect(updateMonitoring);
	onDestroy(() => { monitor.dispose(); controller.dispose(); });
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

<section aria-labelledby="emg-analysis-title" class="min-w-0">
	<div class="flex flex-wrap items-baseline gap-x-4 gap-y-2">
		<h2 id="emg-analysis-title" class="display text-[28px] md:text-[32px]"><span class="text-lime">EMG</span> <span class="outline-text">fatigue</span></h2>
		<span class="label border border-lime px-2 py-1 text-lime">Experimental · 125 Hz</span>
	</div>
	<p class="mt-3 text-[15px] leading-relaxed text-muted">Automatically analyze up to 60 continuous seconds of raw EMG. Fatigue scores are unvalidated at this sampling rate.</p>
	<p class="mt-2 text-[14px] leading-relaxed text-muted">This is a retrospective snapshot. Each moving window resets repetition numbering and the first-three-repetition baseline. At least 10 seconds and three detected repetitions are required.</p>
	<div class="mt-5 flex flex-wrap gap-3">
		{#if result}
			<button class="btn btn-line gap-2 px-4" onclick={download}><Download size={17} />Export EMG JSON</button>
		{/if}
	</div>
	<p class="mt-3 text-[14px] text-muted" role="status">{analysis.busy ? analysis.status : !monitoring ? 'Monitoring paused. Active runs may finish.' : analysis.error ? 'Analysis failed. Retrying automatically with backoff.' : analysis.status || 'Waiting for database readings.'}</p>
	{#if sourceError || analysis.error}<p class="mt-3 border-l-2 border-lime bg-raised px-4 py-3 text-[15px]" role="alert">{sourceError || analysis.error} {result ? 'The previous snapshot is retained below.' : ''}</p>{/if}
	{#if result}
		<div class="mt-5 border border-rule bg-panel p-4 md:p-5">
			<p class="label text-lime">{result.status === 'ready' ? 'Analyzed snapshot' : 'Analysis unavailable'}</p>
			<p class="mt-2 text-[14px] leading-relaxed text-muted tabular-nums">{result.window.sampleCount.toLocaleString('en-GB')} samples · {result.window.duration.toFixed(1)} seconds · {EMG.sampleRate} Hz</p>
			{#if result.window.firstRecordId !== null}
				<p class="mt-1 text-[14px] text-muted tabular-nums">Records {result.window.firstRecordId}–{result.window.lastRecordId}</p>
				<p class="mt-1 text-[13px] text-muted">{time(result.window.startedAt)} – {time(result.window.endedAt)} · Warsaw</p>
			{/if}
			{#if stale}<p class="mt-3 text-[14px] text-lime">Stale snapshot. Showing the previous completed analysis.</p>{/if}
			{#if newerData}<p class="mt-3 text-[14px] text-lime">Newer readings are available. Monitoring updates this snapshot when active.</p>{/if}
			{#if result.status === 'unavailable'}
				<p class="mt-4 text-[15px]">{result.reason}</p>
			{:else}
				<p class="display mt-5 text-[22px]">{result.rows.length} repetitions</p>
				<p class="mt-2 text-[16px]">{result.triggerRep === null ? 'No experimental fatigue trigger in this window.' : `Experimental fatigue trigger at repetition ${result.triggerRep}.`}</p>
				<p class="mt-2 text-[13px] text-muted">Trigger: 2 of the last 3 scores ≥ 58%. Analysis took {(result.elapsedMs / 1000).toFixed(2)} seconds.</p>
				<RepConsistency rows={result.rows} />
				<div class="mt-4 overflow-x-auto">
					<table class="w-full text-left text-[14px] tabular-nums">
						<caption class="sr-only">Experimental fatigue scores by repetition, unvalidated at 125 Hz</caption>
						<thead class="label text-lime"><tr class="border-b border-rule"><th scope="col" class="py-2 pr-4">Rep</th><th scope="col" class="py-2 pr-4">Peak (s)</th><th scope="col" class="py-2 pr-4">Score</th><th scope="col" class="py-2">≥ 58%</th></tr></thead>
						<tbody>{#each result.rows as row (row.rep)}<tr class="border-b border-rule"><th scope="row" class="py-2 pr-4 font-semibold">{row.rep}</th><td class="py-2 pr-4">{row.peak_time.toFixed(2)}</td><td class="py-2 pr-4">{(row.proba * 100).toFixed(1)}%</td><td class="py-2">{row.pred ? 'Yes' : 'No'}</td></tr>{/each}</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</section>
