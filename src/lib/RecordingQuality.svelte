<script lang="ts">
	import type { RecordingQualitySummary } from './recording-quality.ts';
	let { summary, title = 'Recording quality', label = 'Loaded signal window', loadedAt = '', stale = false, monitoring = true, refreshing = false }: {
		summary: RecordingQualitySummary; title?: string; label?: string; loadedAt?: string; stale?: boolean; monitoring?: boolean; refreshing?: boolean;
	} = $props();
	const uid = $props.id();
	const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
	const time = (value: string) => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-GB', {
		dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Warsaw'
	}).format(new Date(value)) : 'Unavailable';
	let timingProblems = $derived(summary.invalidTimestampCount + summary.nonIncreasingTimestampCount);
	let interruptions = $derived(summary.recordGapCount + summary.pauseCount);
</script>

<section class="@container border border-rule bg-night p-4 md:p-5" aria-labelledby={`${uid}-title`}>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h3 id={`${uid}-title`} class="display text-[20px]">{title}</h3>
		<p class="label text-muted">{label}</p>
	</div>
	<p class="mt-3 text-[13px] leading-relaxed text-muted">{summary.rowCount.toLocaleString('en-GB')} loaded samples{summary.captureDurationSeconds !== null ? ` · ${number(summary.captureDurationSeconds)} s capture span` : ''}. Coverage describes available values in these rows.</p>
	{#if summary.rowCount}
		<div class="mt-4 grid gap-4 @lg:grid-cols-3">
			{#each summary.channels as channel (channel.key)}
				<div>
					<p class="label text-muted">{channel.name}</p>
					<p class="mt-1 text-[22px] font-semibold tabular-nums">{channel.coveragePercent === null ? 'Unavailable' : `${number(channel.coveragePercent)}%`}</p>
					<p class="mt-1 text-[13px] text-muted tabular-nums">{channel.validCount.toLocaleString('en-GB')} / {summary.rowCount.toLocaleString('en-GB')} valid samples</p>
					<p class="mt-1 text-[13px]" class:text-lime={channel.validCount < summary.rowCount}>{channel.validCount === summary.rowCount ? 'All samples present' : `Missing samples: ${(summary.rowCount - channel.validCount).toLocaleString('en-GB')}`}</p>
					<p class="mt-1 text-[13px] text-muted">{number(channel.usableDurationSeconds)} s across continuous usable intervals</p>
					{#if channel.missingRunCount}<p class="mt-1 text-[13px] text-lime">{channel.missingRunCount} missing run{channel.missingRunCount === 1 ? '' : 's'} · longest {channel.longestMissingRun} sample{channel.longestMissingRun === 1 ? '' : 's'}</p>{/if}
				</div>
			{/each}
		</div>
		<div class="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-rule pt-3 text-[13px]">
			<p>{timingProblems || summary.pauseCount ? `Timing issues${timingProblems ? ` · ${timingProblems} timestamp issue${timingProblems === 1 ? '' : 's'}` : ''}` : 'Timestamps ordered'}</p>
			<p>{interruptions ? `${summary.recordGapCount} record gap${summary.recordGapCount === 1 ? '' : 's'} · ${summary.pauseCount} capture pause${summary.pauseCount === 1 ? '' : 's'}` : 'No record gaps or capture pauses'}</p>
			<p class="tabular-nums">Observed timing: {summary.observedRateHz === null ? 'unavailable' : `${number(summary.observedRateHz)} Hz`}</p>
		</div>
		<details class="mt-3 text-[13px] text-muted">
			<summary class="cursor-pointer py-2 text-white">Timing and sample details</summary>
			<p class="mt-2">{summary.invalidTimestampCount} invalid timestamp{summary.invalidTimestampCount === 1 ? '' : 's'} · {summary.nonIncreasingTimestampCount} repeated or backwards interval{summary.nonIncreasingTimestampCount === 1 ? '' : 's'}.</p>
			<p class="mt-2">{summary.missingIdCount} absent record ID{summary.missingIdCount === 1 ? '' : 's'} across {summary.recordGapCount} gap{summary.recordGapCount === 1 ? '' : 's'} · {summary.invalidIdCount} invalid record ID{summary.invalidIdCount === 1 ? '' : 's'}. ID gaps and pauses may describe the same interruption.</p>
			<p class="mt-2">Observed timing uses typical consecutive capture intervals. It does not change the sampling rate assumed by analysis models.</p>
			<p class="mt-2">Coverage does not measure sensor placement or clinical signal quality. Missing data and capture interruptions are excluded from continuous usable duration.</p>
		</details>
	{:else}
		<p class="mt-3 text-[15px]">Quality indicators appear once readings are loaded.</p>
	{/if}
	{#if summary.endedAt}<p class="mt-3 text-[13px] text-muted">Last valid capture: {time(summary.endedAt)} · Warsaw.</p>{/if}
	{#if loadedAt}<p class="mt-1 text-[13px] text-muted">Last successful fetch: {time(loadedAt)} · Warsaw.</p>{/if}
	{#if stale}<p class="mt-2 text-[13px] text-lime" role="status">Stale snapshot. Showing quality from the last completed load.</p>{/if}
	{#if !monitoring}<p class="mt-2 text-[13px] text-muted" role="status">Monitoring paused. Capture times describe the retained snapshot.</p>
	{:else if refreshing}<p class="mt-2 text-[13px] text-muted" role="status">Refreshing. Quality describes the last completed load.</p>{/if}
</section>
