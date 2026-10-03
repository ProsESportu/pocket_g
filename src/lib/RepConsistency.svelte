<script lang="ts">
	import type { EmgPrediction } from './emg.ts';
	import { repConsistency } from './rep-consistency.ts';

	let { rows }: { rows: readonly Pick<EmgPrediction, 'rep' | 'peak_time'>[] } = $props();
	let timing = $derived(repConsistency(rows));
	let selectedIndex = $state(0);
	let selected = $derived(timing.status === 'ready' ? timing.intervals[selectedIndex] ?? timing.intervals[0] : null);
	let maximum = $derived(timing.status === 'ready' ? Math.max(...timing.intervals.map((interval) => interval.seconds)) : 1);
	const deviation = (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
</script>

<section class="mt-6 border-t border-rule pt-5" aria-labelledby="rep-consistency-title">
	<h3 id="rep-consistency-title" class="display text-[22px]">Rep consistency</h3>
	<p class="mt-2 text-[14px] leading-relaxed text-muted">Timing between detected repetitions in this analyzed snapshot. Lower timing variation means more consistent timing.</p>
	{#if timing.status === 'unavailable'}
		<p class="mt-3 text-[14px] text-muted">{timing.reason}</p>
	{:else}
		<div class="mt-4 flex flex-wrap gap-x-8 gap-y-3 tabular-nums">
			<div><p class="label text-muted">Median interval</p><p class="mt-1 text-[23px] font-semibold">{timing.medianSeconds.toFixed(2)} <span class="text-[14px] text-muted">s</span></p></div>
			<div><p class="label text-muted">Timing variation</p><p class="mt-1 text-[23px] font-semibold">{timing.variationPercent.toFixed(1)}<span class="text-[14px] text-muted">%</span></p></div>
		</div>
		<p class="mt-3 text-[12px] text-muted">Population standard deviation ÷ mean interval × 100. These timings describe detected peaks, with no assessment of fatigue or technique.</p>
		<p class="mt-4 text-[12px] text-muted tabular-nums">Interval (seconds) · zero baseline · <span class="text-lime">dashed line: median {timing.medianSeconds.toFixed(2)} s</span></p>
		<div class="mt-2 overflow-x-auto pb-2">
			<div class="w-full min-w-fit">
				<div class="relative h-[180px] border-b border-rule bg-night">
					<div aria-hidden="true" class="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-lime" style:bottom={`${timing.medianSeconds / maximum * 85}%`}></div>
					<div class="flex h-full gap-3 px-2">
						{#each timing.intervals as interval, index (`${interval.fromRep}-${interval.toRep}`)}
							<button type="button" class="relative h-full min-w-11 flex-1 border-x border-transparent hover:bg-raised focus-visible:bg-raised"
								aria-label={`Repetitions ${interval.fromRep} to ${interval.toRep}: ${interval.seconds.toFixed(2)} seconds, ${deviation(interval.medianDeviationPercent)} compared with the median`}
								aria-pressed={selected === interval}
								onpointerenter={() => { selectedIndex = index; }} onfocus={() => { selectedIndex = index; }} onclick={() => { selectedIndex = index; }}>
								<span aria-hidden="true" class={`absolute inset-x-1 bottom-0 border-t-2 ${selected === interval ? 'border-white bg-lime' : 'border-lime bg-lime/50'}`} style:height={`${interval.seconds / maximum * 85}%`}></span>
							</button>
						{/each}
					</div>
				</div>
				<div aria-hidden="true" class="mt-2 flex gap-3 px-2 text-center text-[12px] text-muted tabular-nums">
					{#each timing.intervals as interval (`${interval.fromRep}-${interval.toRep}`)}<span class="min-w-11 flex-1 whitespace-nowrap">{interval.fromRep} → {interval.toRep}</span>{/each}
				</div>
			</div>
		</div>
		<p class="mt-1 text-[12px] text-muted">0 s baseline · rep pair along the horizontal axis. Hover, tap, or focus a bar for its timing.</p>
		<p class="mt-3 min-h-10 border-l-2 border-lime bg-raised px-3 py-2 text-[14px] tabular-nums" role="status">
			{#if selected}<strong>{selected.fromRep} → {selected.toRep}</strong>: {selected.seconds.toFixed(2)} s · {deviation(selected.medianDeviationPercent)} compared with the median{/if}
		</p>
		<details class="mt-3 border-t border-rule pt-3">
			<summary class="text-[14px] text-muted">Rep timing values</summary>
			<div class="mt-2 overflow-x-auto">
				<table class="w-full text-left text-[14px] tabular-nums">
					<caption class="sr-only">Time between consecutive detected peaks and difference from the median interval</caption>
					<thead class="label text-lime"><tr class="border-b border-rule"><th scope="col" class="py-2 pr-4">Rep pair</th><th scope="col" class="py-2 pr-4">Interval (s)</th><th scope="col" class="py-2">From median</th></tr></thead>
					<tbody>{#each timing.intervals as interval (`${interval.fromRep}-${interval.toRep}`)}<tr class="border-b border-rule"><th scope="row" class="py-2 pr-4 font-semibold whitespace-nowrap">{interval.fromRep} → {interval.toRep}</th><td class="py-2 pr-4">{interval.seconds.toFixed(2)}</td><td class="py-2">{deviation(interval.medianDeviationPercent)}</td></tr>{/each}</tbody>
				</table>
			</div>
		</details>
	{/if}
</section>
