<script lang="ts">
	import { GYRO, type GyroEnergySet } from './gyro-energy.ts';

	let { sets }: { sets: readonly GyroEnergySet[] } = $props();
	const uid = $props.id();
	let maximum = $derived(sets.reduce((largest, set) => Math.max(largest, set.workJ), 0));
	const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 5 }).format(value);
	const seconds = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
	const time = (value: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Warsaw' }).format(new Date(value));
	const status = (value: GyroEnergySet['status']) => value === 'completed' ? 'Completed' : value === 'interrupted' ? 'Interrupted' : 'Ongoing';
</script>

<section class="mt-6 border-t border-rule pt-5" aria-labelledby={`${uid}-title`}>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h3 id={`${uid}-title`} class="label text-lime">Energy by detected set</h3>
		<p class="text-[13px] text-muted">{sets.length} set{sets.length === 1 ? '' : 's'}</p>
	</div>
	<p class="mt-3 text-[13px] leading-relaxed text-muted">Sets are estimated from movement. {GYRO.setRestSeconds} recorded seconds below {GYRO.restRadiansPerSecond} rad/s of smoothed speed end a set; recording gaps interrupt it. Short rests stay in the same set.</p>
	{#if sets.length}
		<ul class="mt-5 max-h-72 space-y-4 overflow-y-auto pr-2" aria-label="Estimated positive kinetic work in joules by detected set">
			{#each sets as set (set.firstRecordId)}
				<li>
					<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[14px]">
						<p><strong>Set {set.set}</strong><span class={['ml-3 text-[12px]', set.status === 'ongoing' ? 'text-lime' : 'text-muted']}>{status(set.status)}</span></p>
						<p class="font-semibold tabular-nums">{number(set.workJ)} <span class="text-lime">J</span></p>
					</div>
					<div class="mt-2 h-3 border-l border-white/40 bg-raised" aria-hidden="true">
						<div class={['h-full', set.status === 'interrupted' ? 'bg-white/45' : 'bg-lime']} style:width={`${maximum > 0 ? set.workJ / maximum * 100 : 0}%`}></div>
					</div>
					<p class="mt-1 text-[12px] text-muted tabular-nums">{seconds(set.durationSeconds)} s from first to last active sample</p>
				</li>
			{/each}
		</ul>
		<details class="mt-5">
			<summary class="text-[14px] font-semibold">Set recording details</summary>
			<div class="mt-3 max-h-72 overflow-auto">
				<table class="w-full border-collapse text-left text-[13px] tabular-nums">
					<caption class="sr-only">Capture ranges for detected gyro sets, in Warsaw time</caption>
					<thead class="label text-muted"><tr class="border-b border-rule"><th scope="col" class="py-2 pr-4">Set</th><th scope="col" class="py-2 pr-4">Recording range (Warsaw)</th><th scope="col" class="py-2">Records</th></tr></thead>
					<tbody>
						{#each sets as set (set.firstRecordId)}
							<tr class="border-b border-rule"><th scope="row" class="py-3 pr-4 font-semibold">{set.set}</th><td class="py-3 pr-4"><span class="block whitespace-nowrap">{time(set.startedAt)}</span><span class="block whitespace-nowrap">to {time(set.endedAt)}</span></td><td class="py-3 whitespace-nowrap">{set.firstRecordId}–{set.lastRecordId}</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</details>
	{:else}
		<p class="mt-4 text-[14px] text-muted">No movement sets detected in these gyro readings yet.</p>
	{/if}
</section>
