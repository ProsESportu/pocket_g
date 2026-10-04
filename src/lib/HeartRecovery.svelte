<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import * as env from '$app/env/public';
	import { TriangleAlert } from '@lucide/svelte';
	import type { PulseReading } from './pulse.ts';
	import type { RepSet } from './reps.ts';
	import { loadRecoveryPulse, measureRecovery, RECOVERY, RECOVERY_TOTAL_SECONDS, type Recovery, type RecoveryCache } from './recovery.ts';

	// `pulseRate` times the pulse when the board's timestamps run backwards, as the heart-rate panel does.
	let { sets, latestPulse, refreshRequest, offsetSeconds = 0, pulseRate = null, history = $bindable([]) }: {
		sets: readonly RepSet[]; latestPulse?: { id: number; created_at: string };
		refreshRequest: { sequence: number; manual: boolean }; offsetSeconds?: number; pulseRate?: number | null; history?: Recovery[];
	} = $props();
	const uid = $props.id();
	const HEIGHT = 150;

	type Active = { startMs: number; label: string; rows: PulseReading[]; lastId: number | null; cache: RecoveryCache };
	let active = $state.raw<Active | null>(null);
	let busy = $state(false);
	let error = $state('');
	let mounted = $state(false);
	let width = $state(480);
	// Sets are numbered in record order; ones that had already finished when the motion history first loaded
	// never start a recovery.
	let handledThrough = -1;
	let primed = false;
	let seen = -1;
	let generation = 0;
	let aborter: AbortController | null = null;

	let live = $derived(active ? measureRecovery(active.rows, active.startMs, active.label, pulseRate, active.cache) : null);
	let shown = $derived(live ?? history.at(-1) ?? null);
	let left = $derived(live ? Math.max(0, Math.ceil(RECOVERY_TOTAL_SECONDS - live.elapsedSeconds)) : 0);
	let chart = $derived.by(() => {
		const points = (shown?.curve ?? []).filter((point): point is { seconds: number; bpm: number } => point.bpm !== null);
		if (!points.length) return null;
		const values = points.map((point) => point.bpm);
		const middle = (Math.min(...values) + Math.max(...values)) / 2, span = Math.max(30, Math.max(...values) - Math.min(...values) + 10);
		const [low, high] = [middle - span / 2, middle + span / 2];
		const x = (seconds: number) => 12 + seconds / RECOVERY_TOTAL_SECONDS * (width - 24);
		const y = (bpm: number) => HEIGHT - 20 - (bpm - low) / (high - low) * (HEIGHT - 40);
		return {
			path: points.map((point, i) => `${i ? 'L' : 'M'}${x(point.seconds).toFixed(1)},${y(point.bpm).toFixed(1)}`).join(' '),
			dots: points.map((point) => ({ x: x(point.seconds), y: y(point.bpm), seconds: point.seconds })),
			marks: [{ x: x(RECOVERY.windowSeconds / 2), label: 'Start' }, { x: x(RECOVERY.seconds), label: '1 min' }],
			low: Math.round(low), high: Math.round(high)
		};
	});
	const bpm = (value: number | null) => value === null ? '–' : Math.round(value).toString();
	const time = (ms: number) => new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(ms));

	function start(startMs: number, label: string) {
		aborter?.abort();
		generation++;
		busy = false;
		active = { startMs, label, rows: [], lastId: null, cache: {} };
		error = '';
		void load();
	}
	function cancel() {
		aborter?.abort();
		generation++;
		busy = false;
		active = null;
	}
	async function load() {
		const current = active;
		if (!current || busy || !env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) return;
		const token = generation;
		busy = true;
		aborter = new AbortController();
		try {
			const rows = await loadRecoveryPulse(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, current.startMs, current.lastId, aborter.signal);
			if (token !== generation) return;
			const next = rows.length ? { ...current, rows: [...current.rows, ...rows], lastId: rows.at(-1)!.id } : current;
			const result = measureRecovery(next.rows, next.startMs, next.label, pulseRate, next.cache);
			error = '';
			if (result.status === 'recording') active = next;
			else { history = [...history, result].slice(-RECOVERY.keep); active = null; }
		} catch (caught) {
			if (token === generation) error = caught instanceof Error && caught.name !== 'AbortError' ? caught.message : 'Could not load pulse samples. Retrying with the next refresh.';
		} finally {
			if (token === generation) busy = false;
		}
	}
	onMount(() => {
		mounted = true;
		return () => { aborter?.abort(); generation++; };
	});
	function observe() {
		const current = sets, request = refreshRequest, offset = offsetSeconds, ready = mounted;
		untrack(() => {
			if (!ready) return;
			const completed = current.filter((set) => set.status === 'completed');
			const newest = Math.max(handledThrough, ...completed.map((set) => set.firstRecordId));
			if (!primed && current.length) { primed = true; handledThrough = newest; }
			const finished = completed.findLast((set) => set.reps.length && set.firstRecordId > handledThrough);
			handledThrough = newest;
			// The motion sensor's clock may run ahead of the pulse board's; the offset moves the set end onto the pulse clock.
			if (finished) start(Date.parse(finished.endedAt) - offset * 1000, `set ${finished.set}`);
			else if (request.sequence !== seen) void load();
			seen = request.sequence;
		});
	}
	$effect(observe);
</script>

<section class="min-w-0" aria-labelledby={`${uid}-title`}>
	<div class="flex flex-wrap items-baseline gap-x-4 gap-y-2">
		<h2 id={`${uid}-title`} class="display text-[28px] md:text-[32px]"><span class="text-mint">Heart</span> <span class="outline-text">recovery</span></h2>
		<span class="label border border-mint px-2 py-1 text-mint">Pulse</span>
	</div>
	<p class="mt-3 text-[15px] leading-relaxed text-muted">How far your heart rate falls in the minute after a set. It starts by itself when a set ends, so sit still while it records.</p>
	<div class="relative mt-5 border border-rule bg-night p-5 md:p-6" aria-busy={busy}>
		{#if live}
			<p class="label text-mint" role="status">Recording after {live.label} · {left} s left</p>
			<p class="mt-3 flex flex-wrap items-baseline gap-3 leading-none"><span class="text-[clamp(40px,7vw,64px)] font-extrabold tracking-tight tabular-nums">{bpm(live.startBpm)}</span><span class="display text-[20px] text-mint">BPM at start</span></p>
			<p class="mt-3 text-[14px] text-muted">{live.elapsedSeconds < 1 ? 'Waiting for pulse readings after the set.' : live.startBpm === null && live.elapsedSeconds >= RECOVERY.windowSeconds ? 'No clear beats in the first 10 seconds yet. Keep the pulse sensor still.' : `Started ${time(live.startMs)}.`}</p>
		{:else if shown?.status === 'done'}
			<p class="label text-mint">After {shown.label}</p>
			<p class="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2 leading-none tabular-nums">
				<span class="text-[clamp(40px,7vw,64px)] font-extrabold tracking-tight">{shown.dropBpm! >= 0 ? '−' : '+'}{Math.abs(Math.round(shown.dropBpm!))}</span>
				<span class="display text-[20px] text-mint">BPM in {RECOVERY.seconds} s</span>
			</p>
			<p class="mt-3 text-[15px] tabular-nums">{bpm(shown.startBpm)} → {bpm(shown.endBpm)} BPM <span class="text-muted">· started {time(shown.startMs)}</span></p>
			<p class="mt-2 text-[14px] text-muted">A bigger drop means your heart is settling faster.</p>
		{:else if shown?.status === 'unavailable'}
			<p class="label text-mint">After {shown.label}</p>
			<p class="mt-3 text-[18px] font-semibold">Recovery couldn’t be measured.</p>
			<p class="mt-2 text-[15px] leading-relaxed text-muted">{shown.reason}</p>
		{:else}
			<p class="text-[20px] font-semibold">No recovery recorded yet.</p>
			<p class="mt-2 text-[15px] leading-relaxed text-muted">Finish a set with the motion sensor and rest, or press Start recovery now when you stop.</p>
		{/if}

		{#if shown}
			<div class="chart-grid relative mt-5 h-[150px] min-w-0 border border-rule" bind:clientWidth={width}>
				{#if chart}
					<svg class="absolute inset-0 block" {width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img" aria-label={`Heart rate over the minute after ${shown.label}, from ${bpm(shown.curve.find((point) => point.bpm !== null)?.bpm ?? null)} BPM`}>
						{#each chart.marks as mark (mark.label)}
							<line x1={mark.x} x2={mark.x} y1="14" y2={HEIGHT - 16} class="stroke-white/30" stroke-dasharray="3 3" />
							<text x={mark.x} y="11" text-anchor="middle" class="fill-muted text-[11px]">{mark.label}</text>
						{/each}
						<text x="6" y={HEIGHT - 6} class="fill-muted text-[11px]">{chart.low}–{chart.high} BPM</text>
						<path d={chart.path} fill="none" stroke="var(--color-mint)" stroke-width="2" stroke-linejoin="round" />
						{#each chart.dots as dot (dot.seconds)}<circle cx={dot.x} cy={dot.y} r="3.5" class="fill-mint" />{/each}
					</svg>
				{:else}
					<p class="absolute inset-0 grid place-items-center px-4 text-center text-[14px] text-muted">The curve fills in every {RECOVERY.stepSeconds} seconds once beats are clear.</p>
				{/if}
			</div>
			<p class="mt-1 text-[12px] text-muted">Heart rate over {Math.round(RECOVERY_TOTAL_SECONDS)} s, each point from 10 s of pulse.</p>
		{/if}

		<div class="mt-5 flex flex-wrap gap-3">
			{#if active}
				<button type="button" class="btn btn-line" onclick={cancel}>Cancel recovery</button>
			{:else}
				<button type="button" class="btn btn-lime" disabled={!latestPulse} onclick={() => latestPulse && start(Date.parse(latestPulse.created_at), 'you pressed Start')}>Start recovery now</button>
			{/if}
		</div>
		{#if error}<p class="mt-3 flex gap-2 text-[15px] leading-relaxed" role="alert"><TriangleAlert size={18} class="mt-0.5 shrink-0 text-lime" /><span>{error}</span></p>{/if}
		{#if history.length > (live ? 0 : 1)}
			<p class="mt-4 text-[14px] text-muted tabular-nums">Earlier: {history.slice(0, live ? undefined : -1).toReversed().map((item) => `${item.label} ${item.status === 'done' ? `${item.dropBpm! >= 0 ? '−' : '+'}${Math.abs(Math.round(item.dropBpm!))}` : 'unclear'}`).join(' · ')}</p>
		{/if}
		<p class="mt-4 text-[13px] leading-relaxed text-muted">Compares the first {RECOVERY.windowSeconds} seconds after the set with the {RECOVERY.windowSeconds} seconds around one minute later. Results are kept only in this tab.</p>
	</div>
</section>
