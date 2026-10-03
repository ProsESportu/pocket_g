<script lang="ts">
	import { invalidate } from '$app/navigation';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
	let search = $state('');
	let refreshing = $state(false);
	let refreshError = $state('');
	let page = $state(0);
	const pageSize = 20;
	let latest = $derived(data.readings[0]);
	let filtered = $derived(data.readings.filter((row) => [row.id, row.created_at, row.ekg, row.emg, row.puls].join(' ').toLowerCase().includes(search.toLowerCase())));
	let pages = $derived(Math.max(1, Math.ceil(filtered.length / pageSize)));
	let currentPage = $derived(Math.min(page, pages - 1));
	let visible = $derived(filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize));
	const date = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));
	async function refresh() {
		refreshing = true;
		refreshError = '';
		try { await invalidate('app:readings'); }
		catch { refreshError = 'Refresh failed. Please try again.'; }
		finally { refreshing = false; }
	}
</script>

<svelte:head>
	<title>Pocket G · Sensor readings</title>
	<meta name="description" content="A small Supabase sample app for browsing EKG, EMG and pulse readings." />
</svelte:head>

<div class="app-shell">
	<header class="topbar">
		<a class="brand" href="/" aria-label="Pocket G home"><span class="brand-icon">∿</span> pocket<span class="brand-g">g</span></a>
		<span class="project">hackyeah2026 <span class="project-dot"></span> Supabase</span>
	</header>
	<main>
		<div class="intro">
			<div><p class="eyebrow">YOUR DATA, AT A GLANCE</p><h1>Sensor readings<span>.</span></h1><p class="subtitle">A little window into your Supabase data.</p></div>
			<button class="refresh" onclick={refresh} disabled={refreshing}><span aria-hidden="true">↻</span> {refreshing ? 'Refreshing…' : 'Refresh data'}</button>
		</div>
		<div class="connection"><span class:failed={!!data.error} class="status-dot"></span><span>{data.error ? 'Connection needs attention' : 'Connected to Supabase'}</span><span class="source">public.ekgemgpuls</span></div>
		{#if data.error || refreshError}<div class="error" role="alert">{data.error || refreshError}</div>{/if}
		<section class="metrics" aria-label="Latest sensor values">
			{#each [{ label: 'EKG', value: latest?.ekg, symbol: '∿' }, { label: 'EMG', value: latest?.emg, symbol: '⌁' }, { label: 'Pulse', value: latest?.puls, symbol: '♡' }] as metric (metric.label)}
				<article class="metric"><div class="metric-top"><span>{metric.label}</span><span class="metric-icon" aria-hidden="true">{metric.symbol}</span></div><div class="metric-value">{metric.value ?? '—'}</div><p>Latest recorded value</p></article>
			{/each}
			<article class="metric count"><div class="metric-top"><span>Total readings</span><span class="metric-icon" aria-hidden="true">▤</span></div><div class="metric-value">{data.error ? '—' : data.total.toLocaleString('en-GB')}</div><p>Visible through the API</p></article>
		</section>
		<section class="data-panel" aria-labelledby="readings-title" aria-busy={refreshing}>
			<div class="panel-heading"><div><h2 id="readings-title">Recent readings <span class="badge">{data.readings.length}</span></h2><p>Latest 100 records, newest first.</p></div><label class="search"><span aria-hidden="true">⌕</span><input aria-label="Search recent readings" placeholder="Search readings…" bind:value={search} oninput={() => page = 0} /></label></div>
			<div class="table-scroll"><table><thead><tr><th scope="col">Record ID</th><th scope="col">Recorded at <span class="timezone">(Warsaw)</span></th><th scope="col">EKG</th><th scope="col">EMG</th><th scope="col">Pulse</th></tr></thead><tbody>
				{#each visible as row (row.id)}<tr><td class="record">#{row.id}</td><td class="timestamp">{date(row.created_at)}</td><td>{row.ekg ?? '—'}</td><td>{row.emg ?? '—'}</td><td><span class="pulse-value">{row.puls ?? '—'}</span></td></tr>{/each}
			</tbody></table></div>
			{#if visible.length === 0}<div class="empty"><span aria-hidden="true">▤</span><h3>{search ? 'No matching readings' : 'No readings to show yet'}</h3><p>{search ? 'Try another record ID or sensor value.' : 'An empty table or a missing SELECT policy can return no rows. Check access in Supabase, then refresh.'}</p></div>{/if}
			<div class="panel-footer"><span>{filtered.length ? currentPage * pageSize + 1 : 0}–{Math.min((currentPage + 1) * pageSize, filtered.length)} of {filtered.length} loaded readings</span><div class="pagination"><button aria-label="Previous page" disabled={currentPage === 0 || refreshing} onclick={() => page = currentPage - 1}>←</button><span>{currentPage + 1} / {pages}</span><button aria-label="Next page" disabled={currentPage >= pages - 1 || refreshing} onclick={() => page = currentPage + 1}>→</button></div></div>
		</section>
		<footer class="footnote"><span>Read-only sample · Powered by Supabase</span><span aria-live="polite">{data.loadedAt ? `Last fetched ${date(data.loadedAt)}` : 'Waiting for connection'}</span></footer>
	</main>
</div>
