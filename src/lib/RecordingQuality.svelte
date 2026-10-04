<script lang="ts">
	import type { RecordingQualitySummary } from './recording-quality.ts';
	let { summary, title = 'Sensor health', label = 'Loaded signal window', loadedAt = '', stale = false, monitoring = true, refreshing = false }: {
		summary: RecordingQualitySummary; title?: string; label?: string; loadedAt?: string; stale?: boolean; monitoring?: boolean; refreshing?: boolean;
	} = $props();
	const uid = $props.id();
	const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
	const count = (value: number) => value.toLocaleString('en-GB');
	const plural = (value: number, word: string) => `${count(value)} ${word}${value === 1 ? '' : 's'}`;
	const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', {
		dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Warsaw'
	}).format(new Date(value)) : 'Unavailable';
</script>

<section class="@container border border-rule bg-night p-4 md:p-5" aria-labelledby={`${uid}-title`} aria-busy={refreshing}>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h3 id={`${uid}-title`} class="display text-[20px]">{title}</h3>
		<p class="label text-muted">{label}</p>
	</div>
	<p class="mt-3 text-[13px] leading-relaxed text-muted">How much of each signal actually arrived. 100% means nothing went missing.</p>
	{#if summary.rowCount}
		<div class="mt-4 grid gap-4 @lg:grid-cols-3">
			{#each summary.channels as channel (channel.key)}
				<div>
					<p class="label text-muted">{channel.name}</p>
					<p class="mt-1 text-[22px] font-semibold tabular-nums">{channel.coveragePercent === null ? 'Unavailable' : `${number(channel.coveragePercent)}%`}</p>
					<p class="mt-1 text-[13px]" class:text-lime={channel.validCount < summary.rowCount}>{channel.validCount === summary.rowCount ? 'Nothing missing' : `Missing ${plural(summary.rowCount - channel.validCount, 'sample')}`}</p>
				</div>
			{/each}
		</div>
		<details class="mt-4 border-t border-rule pt-1 text-[13px] text-muted">
			<summary class="py-2 text-white">Technical details</summary>
			<p class="mt-2 tabular-nums">{plural(summary.rowCount, 'loaded sample')}{summary.captureDurationSeconds !== null ? ` over ${number(summary.captureDurationSeconds)} s` : ''} · observed rate {summary.observedRateHz === null ? 'unavailable' : `${number(summary.observedRateHz)} Hz`}.</p>
			{#each summary.channels as channel (channel.key)}
				<p class="mt-2 tabular-nums">{channel.name}: {count(channel.validCount)} / {count(summary.rowCount)} valid · {number(channel.usableDurationSeconds)} s continuous{channel.missingRunCount ? ` · ${plural(channel.missingRunCount, 'missing run')}, longest ${plural(channel.longestMissingRun, 'sample')}` : ''}.</p>
			{/each}
			<p class="mt-2">{plural(summary.invalidTimestampCount, 'invalid timestamp')} · {plural(summary.nonIncreasingTimestampCount, 'repeated or backwards interval')} · {plural(summary.recordGapCount, 'record gap')} ({plural(summary.missingIdCount, 'absent ID')}) · {plural(summary.pauseCount, 'capture pause')} · {plural(summary.invalidIdCount, 'invalid ID')}.</p>
			{#if summary.endedAt}<p class="mt-2">Last valid capture {time(summary.endedAt)}.</p>{/if}
			{#if loadedAt}<p class="mt-2">Last successful fetch {time(loadedAt)}.</p>{/if}
			<p class="mt-2">Coverage counts arrived values only. It doesn’t measure sensor placement or clinical signal quality.</p>
		</details>
	{:else}
		<p class="mt-3 text-[15px]">Appears once readings arrive.</p>
	{/if}
	{#if stale}<p class="mt-2 text-[13px] text-lime" role="status">Couldn’t update. Showing the last result.</p>{/if}
	{#if !monitoring}<p class="mt-2 text-[13px] text-muted" role="status">Paused.</p>{/if}
</section>
