<script lang="ts">
	import { GYRO, type GyroEnergySet } from './gyro-energy.ts';

	let { sets }: { sets: readonly GyroEnergySet[] } = $props();
	const uid = $props.id();
	let maximum = $derived(sets.reduce((largest, set) => Math.max(largest, set.workJ), 0));
	const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 5 }).format(value);
	const seconds = (value: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(value);
	const status = (value: GyroEnergySet['status']) => value === 'completed' ? 'Completed' : value === 'interrupted' ? 'Interrupted' : 'Ongoing';
</script>

<section class="mt-6 border-t border-rule pt-5" aria-labelledby={`${uid}-title`}>
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h3 id={`${uid}-title`} class="label text-lime">Energy per set</h3>
		<p class="text-[13px] text-muted">{sets.length} set{sets.length === 1 ? '' : 's'}</p>
	</div>
	<p class="mt-3 text-[13px] leading-relaxed text-muted">A set ends after {GYRO.setRestSeconds} seconds of stillness. Short pauses stay in the same set.</p>
	{#if sets.length}
		<ul class="mt-5 max-h-72 space-y-4 overflow-y-auto pr-2" aria-label="Work in joules per set">
			{#each sets as set (set.firstRecordId)}
				<li>
					<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[14px]">
						<p><strong>Set {set.set}</strong><span class={['ml-3 text-[12px]', set.status === 'ongoing' ? 'text-lime' : 'text-muted']}>{status(set.status)}</span></p>
						<p class="font-semibold tabular-nums">{number(set.workJ)} <span class="text-lime">J</span></p>
					</div>
					<div class="mt-2 h-3 border-l border-white/40 bg-raised" aria-hidden="true">
						<div class={['h-full', set.status === 'interrupted' ? 'bg-white/45' : 'bg-lime']} style:width={`${maximum > 0 ? set.workJ / maximum * 100 : 0}%`}></div>
					</div>
					<p class="mt-1 text-[12px] text-muted tabular-nums">{seconds(set.durationSeconds)} s of movement</p>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mt-4 text-[14px] text-muted">No sets yet. Start moving and each set appears here.</p>
	{/if}
</section>
