<script lang="ts">
	import { invalidate } from '$app/navigation';
	import { onMount, untrack } from 'svelte';
	import { ChevronLeft, ChevronRight, Pause, Play, RefreshCw, Search, TriangleAlert } from '@lucide/svelte';
	import SessionStrip from '#lib/SessionStrip.svelte';
	import CoachNotes from '#lib/CoachNotes.svelte';
	import EcgAnalysis from '#lib/EcgAnalysis.svelte';
	import EmgAnalysis from '#lib/EmgAnalysis.svelte';
	import { emgCoachNote } from '#lib/emg-coach.ts';
	import type { EmgResult } from '#lib/emg.ts';
	import PulseFrequency from '#lib/PulseFrequency.svelte';
	import { signalChecks } from '#lib/coach.ts';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let lastSuccess = $state<PageData | null>(untrack(() => data.error ? null : data));
	let displayed = $derived(data.error ? lastSuccess ?? data : data);
	let autoRefresh = $state(true);
	let pageVisible = $state(true);
	let search = $state('');
	let refreshing = $state(false);
	let refreshError = $state('');
	let page = $state(0);
	let selectedNote = $state<string | null>(null);
	let emgResult = $state.raw<EmgResult | null>(null);
	const pageSize = 20;
	let notes = $derived([...signalChecks(displayed.readings, displayed.pulse), ...emgCoachNote(emgResult, displayed.readings)]);
	let filtered = $derived(displayed.readings.filter((row) => [row.id, row.created_at, row.ekg, row.emg, row.puls].join(' ').toLowerCase().includes(search.toLowerCase())));
	let pages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
	let currentPage = $derived(Math.min(page, pages - 1));
	let visible = $derived(filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize));
	let failure = $derived(data.error || refreshError);
	let status = $derived(failure ? 'Connection problem' : !autoRefresh ? 'Paused' : !pageVisible ? 'Paused while hidden' : 'Live');
	const date = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));
	const time = (value: string) => new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));
	const cell = (value: number | null) => value === null || !Number.isFinite(value) ? null : new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(value);
	onMount(() => {
		const updateVisibility = () => { pageVisible = document.visibilityState === 'visible'; };
		updateVisibility();
		document.addEventListener('visibilitychange', updateVisibility);
		const timer = window.setInterval(() => {
			if (autoRefresh && pageVisible) void refresh();
		}, 5000);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener('visibilitychange', updateVisibility);
		};
	});
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		refreshError = '';
		try {
			await invalidate('app:readings');
			if (!data.error) lastSuccess = data;
		}
		catch { refreshError = 'Refresh failed.'; }
		finally { refreshing = false; }
	}
</script>

<svelte:head>
	<title>Pocket G</title>
	<meta name="description" content="Live EKG, EMG and pulse readings with sensor checks while you train." />
</svelte:head>

{#snippet value(reading: number | null)}
	{@const shown = cell(reading)}
	{#if shown === null}<span aria-hidden="true" class="text-muted">–</span><span class="sr-only">No value</span>{:else}{shown}{/if}
{/snippet}

<header class="border-b border-rule">
	<div class="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-4 md:px-8">
		<a href="/" class="display inline-flex min-h-11 items-center text-[20px]">Pocket&nbsp;<span class="text-lime">G</span></a>
		<div class="flex items-center gap-2 md:gap-3">
			<p class="label mr-1 flex items-center gap-2 text-muted">
				<svg class="size-2.5 shrink-0" viewBox="0 0 10 10" aria-hidden="true">
					{#if failure}<path d="M5 0.5 9.8 9.5H0.2Z" fill="var(--color-lime)" />
					{:else if status === 'Live'}<circle cx="5" cy="5" r="4" fill="var(--color-lime)" />
					{:else}<circle cx="5" cy="5" r="3.5" fill="none" stroke="currentColor" stroke-width="1.5" />{/if}
				</svg>
				<span class="text-white max-sm:sr-only">{status}</span>
				{#if displayed.loadedAt}<span class="hidden tabular-nums sm:inline">Updated {time(displayed.loadedAt)}</span>{/if}
			</p>
			<button class="btn btn-line px-3 md:px-4" onclick={() => autoRefresh = !autoRefresh}>
				{#if autoRefresh}<Pause size={18} />{:else}<Play size={18} />{/if}
				<span class="sr-only md:not-sr-only">{autoRefresh ? 'Pause live updates' : 'Resume live updates'}</span>
			</button>
			<button class="btn btn-line px-3 md:px-4" onclick={refresh}>
				<RefreshCw size={18} />
				<span class="sr-only md:not-sr-only">Refresh now</span>
			</button>
		</div>
	</div>
</header>

<!-- Full-bleed hero: the outer 1fr gutters let the heart-rate panel run to the right edge like the template's photo panels. -->
<section class="relative grid overflow-hidden border-b border-rule lg:grid-cols-[minmax(2rem,1fr)_minmax(0,736px)_minmax(0,480px)_minmax(2rem,1fr)]" aria-labelledby="page-title">
	<div class="relative z-10 px-4 pt-10 pb-14 md:px-8 md:pt-14 lg:col-start-2 lg:px-0 lg:pr-8 lg:pb-20">
		<h1 id="page-title" class="display text-[clamp(48px,7vw,96px)]">
			<span class="block text-[0.55em]">Live</span>
			<span aria-hidden="true" class="outline-text block">Session</span>
			<span aria-hidden="true" class="outline-text -mt-[0.08em] block">Session</span>
			<span class="-mt-[0.08em] block text-lime">Session</span>
		</h1>
		<p class="mt-6 max-w-[52ch] text-[16px] leading-relaxed text-muted">{displayed.readings.length ? `Your last ${displayed.readings.length} readings in Warsaw time. Each trace has its own scale, so compare a signal with itself rather than with the others.` : 'Your EKG, EMG and pulse appear here as readings arrive, in Warsaw time.'}</p>
	</div>
	<div class="hero-panel relative bg-panel lg:col-span-2 lg:col-start-3">
		<svg class="absolute inset-0 hidden h-full w-full lg:block" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><line x1="16" y1="0" x2="0" y2="100" stroke="var(--color-lime)" stroke-width="2" vector-effect="non-scaling-stroke" /></svg>
		<div aria-hidden="true" class="display pointer-events-none absolute right-0 bottom-5 left-0 hidden overflow-hidden text-[88px] leading-none whitespace-nowrap md:block">
			<span class="outline-text block pl-[10%] [--stroke:var(--color-lime)]">Pulse Pulse Pulse</span>
		</div>
		<div class="relative z-10 px-4 pt-12 pb-14 md:px-8 md:pb-[136px] lg:max-w-[min(100%,560px)] lg:pt-14 lg:pr-8 lg:pl-[22%]">
			<PulseFrequency result={data.pulse} refreshError={failure} {refreshing} />
		</div>
	</div>
	<span aria-hidden="true" class="wedge bottom-0 left-0 z-10 h-3 w-[42%] max-w-[460px]"></span>
</section>

<main class="mx-auto max-w-[1280px] px-4 pt-12 pb-12 md:px-8 md:pt-16">
	{#if failure}
		<div class="mb-10 flex gap-3 border-l-2 border-lime bg-raised px-4 py-3 text-[15px] leading-relaxed" role="alert">
			<TriangleAlert class="mt-0.5 shrink-0 text-lime" size={20} />
			<p>{failure} {lastSuccess ? `Showing readings from ${time(lastSuccess.loadedAt)}.` : ''} {autoRefresh ? 'Retrying every 5 seconds.' : 'Refresh now, or resume live updates to retry.'}</p>
		</div>
	{/if}
	<!-- Keep coach notes alongside the strip and both analysis panels. -->
	<div class="grid items-start gap-x-8 gap-y-14 lg:grid-cols-12">
		<section class="min-w-0 lg:col-span-8" aria-labelledby="signals-title">
			<h2 id="signals-title" class="display mb-5 text-[28px] md:text-[32px]"><span class="text-lime">Your</span> <span class="outline-text">signals</span></h2>
			<SessionStrip readings={displayed.readings} {notes} {selectedNote} unavailable={!!failure} />
		</section>
		<div class="min-w-0 lg:col-span-4 lg:row-span-3">
			<CoachNotes {notes} readingCount={displayed.readings.length} bind:selected={selectedNote} />
		</div>
		<div class="min-w-0 lg:col-span-8">
			<EcgAnalysis window={data.ecg} connectionError={data.error} />
		</div>
		<div class="min-w-0 lg:col-span-8">
			<EmgAnalysis throughId={displayed.readings[0]?.id} connectionError={failure} onresult={(result) => { emgResult = result; }} />
		</div>
	</div>

	<section class="mt-20" aria-labelledby="readings-title">
		<div class="flex flex-wrap items-end justify-between gap-4">
			<div>
				<h2 id="readings-title" class="display text-[28px] md:text-[32px]"><span class="text-lime">Readings</span> <span class="outline-text">log</span></h2>
				<p class="mt-3 text-[15px] text-muted">{displayed.readings.length ? `The last ${displayed.readings.length} records, newest first. Search covers these records only.` : 'Every reading is listed here, newest first.'}</p>
			</div>
			<label class="relative block w-full sm:w-72">
				<span class="sr-only">Search readings</span>
				<Search class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" size={18} />
				<input class="min-h-11 w-full border border-white/45 bg-night pr-3 pl-10 text-[16px] text-white placeholder:text-muted" type="search" placeholder="Record, time or value" bind:value={search} oninput={() => page = 0} />
			</label>
		</div>
		{#if visible.length}
			<div class="mt-5 overflow-x-auto">
				<table class="w-full border-collapse text-left text-[15px] whitespace-nowrap tabular-nums">
					<thead class="label text-lime">
						<tr class="border-b border-lime">
							<th scope="col" class="py-3 pr-3 sm:pr-6 font-bold">Record</th>
							<th scope="col" class="py-3 pr-3 sm:pr-6 font-bold"><span class="sm:hidden">Time</span><span class="hidden sm:inline">Recorded at</span></th>
							<th scope="col" class="py-3 pr-3 sm:pr-6 text-right font-bold">EKG</th>
							<th scope="col" class="py-3 pr-3 sm:pr-6 text-right font-bold">EMG</th>
							<th scope="col" class="py-3 text-right font-bold">Pulse</th>
						</tr>
					</thead>
					<tbody>
						{#each visible as row (row.id)}
							<tr class="border-b border-rule">
								<td class="py-3 pr-3 sm:pr-6 text-muted">{row.id}</td>
								<td class="py-3 pr-3 sm:pr-6"><span class="sm:hidden">{time(row.created_at)}</span><span class="hidden sm:inline">{date(row.created_at)}</span></td>
								<td class="py-3 pr-3 sm:pr-6 text-right font-semibold">{@render value(row.ekg)}</td>
								<td class="py-3 pr-3 sm:pr-6 text-right font-semibold">{@render value(row.emg)}</td>
								<td class="py-3 text-right font-semibold">{@render value(row.puls)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="py-12">
				<p class="display text-[20px]">{search ? 'No matching readings' : failure ? 'No readings loaded' : 'No readings yet'}</p>
				<p class="mt-3 max-w-[60ch] text-[15px] leading-relaxed text-muted">{search ? 'Try another record number, time or value.' : failure ? 'Readings are listed here once the connection is back.' : 'Start recording on your sensor. If readings still don’t appear, check that the table allows SELECT for the publishable key.'}</p>
			</div>
		{/if}
		{#if filtered.length}
			<div class="mt-4 flex flex-wrap items-center justify-between gap-3 text-[14px] text-muted tabular-nums">
				<p>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length} loaded readings</p>
				<div class="flex items-center gap-2">
					<button class="btn btn-line px-0" aria-label="Previous page" disabled={currentPage === 0} onclick={() => page = currentPage - 1}><ChevronLeft size={20} /></button>
					<span class="min-w-16 text-center">{currentPage + 1} of {pages}</span>
					<button class="btn btn-line px-0" aria-label="Next page" disabled={currentPage >= pages - 1} onclick={() => page = currentPage + 1}><ChevronRight size={20} /></button>
				</div>
			</div>
		{/if}
	</section>

	<footer class="label mt-20 flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-rule pt-6 text-muted">
		<p class="flex items-center gap-3"><span class="whitespace-nowrap text-white">Pocket G</span><span aria-hidden="true" class="h-4 w-0.5 bg-lime"></span>Read-only data from public.ekgemgpuls</p>
		<p class="tabular-nums">{displayed.loadedAt ? `Last fetched ${date(displayed.loadedAt)}` : 'Waiting for the first connection'}</p>
	</footer>
</main>

<style>
	/* Diagonal left edge on wide screens, a slanted top edge when stacked. */
	.hero-panel { clip-path: polygon(0 28px, 100% 0, 100% 100%, 0 100%); }
	@media (min-width: 1024px) { .hero-panel { clip-path: polygon(16% 0, 100% 0, 100% 100%, 0 100%); } }
</style>
