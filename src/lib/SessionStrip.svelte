<script lang="ts">
	import type { Reading } from './readings';
	import type { CoachNote } from './coach';
	import { chartData, type Plot, type SensorField } from './chart';
	import { COACH_ICONS } from './coach-icons';

	let { readings, notes = [], selectedNote = null, unavailable = false }: { readings: Reading[]; notes?: CoachNote[]; selectedNote?: string | null; unavailable?: boolean } = $props();

	const LANES: { field: SensorField; label: string; pen: string }[] = [
		{ field: 'ekg', label: 'EKG', pen: 'var(--color-pen-ekg)' },
		{ field: 'emg', label: 'EMG', pen: 'var(--color-pen-emg)' },
		{ field: 'puls', label: 'Pulse', pen: 'var(--color-pen-puls)' }
	];
	// Lane height is a multiple of the 40px major grid so the chart grid runs on across lanes.
	const HEIGHT = 120;
	const uid = $props.id();
	let width = $state(640);
	let selectedId = $state<number | null>(null);

	let frame = $derived<Plot>({ left: 8, right: Math.max(width - 14, 9), top: 16, bottom: HEIGHT - 16, width, height: HEIGHT });
	let lanes = $derived(LANES.map((lane) => {
		const chart = chartData(readings, lane.field, frame);
		const values = chart.points.map((point) => point.row[lane.field]).filter((raw): raw is number => raw !== null && Number.isFinite(raw));
		return { ...lane, chart, isolated: chart.isolated, head: chart.points.findLast((point) => point.y !== null), range: values.length ? { min: Math.min(...values), max: Math.max(...values) } : null };
	}));
	let points = $derived(lanes[0].chart.points);
	let latest = $derived(points.length - 1);
	let found = $derived(selectedId === null ? -1 : points.findIndex((point) => point.row.id === selectedId));
	let inspecting = $derived(found >= 0);
	let index = $derived(inspecting ? found : latest);
	let row = $derived(points[index]?.row);
	// Only the note the athlete selected is highlighted, so the chart stays readable.
	let band = $derived.by(() => {
		const note = notes.find((item) => item.id === selectedNote);
		const from = points.findIndex((point) => point.row.id === note?.fromId);
		const to = points.findIndex((point) => point.row.id === note?.toId);
		if (!note || from < 0 || to < 0) return null;
		const x1 = from > 0 ? (points[from - 1].x + points[from].x) / 2 : points[from].x - 3;
		const x2 = to < points.length - 1 ? (points[to].x + points[to + 1].x) / 2 : points[to].x + 3;
		const w = Math.max(x2 - x1, 6);
		return { x: Math.max(0, Math.min(x1, width - w)), w, Icon: COACH_ICONS[note.kind] };
	});
	// Enough fractional digits that the start, middle and end ticks never read the same.
	let tickDigits = $derived.by(() => {
		const half = points.length ? (Date.parse(points[latest].row.created_at) - Date.parse(points[0].row.created_at)) / 2 : 0;
		return half >= 1000 ? 0 : half >= 100 ? 1 : half >= 10 ? 2 : 3;
	});

	const time = (value: number | string, digits = 0) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: digits ? digits as 1 | 2 | 3 : undefined, timeZone: 'Europe/Warsaw' }).format(new Date(value));
	const number = (raw: number) => new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 }).format(raw);
	const value = (reading: Reading | undefined, field: SensorField) => {
		const raw = reading?.[field];
		return raw === null || raw === undefined || !Number.isFinite(raw) ? 'No value' : number(raw);
	};
	let valuetext = $derived(row ? `${time(row.created_at, 3)}, record ${row.id}. ${LANES.map((lane) => `${lane.label} ${value(row, lane.field)}`).join(', ')}.` : 'No readings');

	function inspect(event: PointerEvent) {
		const axis = (event.currentTarget as HTMLElement).querySelector('[data-axis]');
		if (!axis || !points.length) return;
		const bounds = axis.getBoundingClientRect();
		const x = (event.clientX - bounds.left) / bounds.width * width;
		selectedId = points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best).row.id;
	}
	function release(event: PointerEvent) {
		// Mouse hover is transient; a tap or keyboard choice stays put.
		if (event.pointerType === 'mouse') selectedId = null;
	}
	function step(event: KeyboardEvent) {
		let next = index;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next--;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next++;
		else if (event.key === 'PageDown') next -= 10;
		else if (event.key === 'PageUp') next += 10;
		else if (event.key === 'Home') next = 0;
		else if (event.key === 'End' || event.key === 'Escape') next = -1;
		else return;
		event.preventDefault();
		selectedId = next < 0 ? null : points[Math.max(0, Math.min(next, latest))]?.row.id ?? null;
	}
</script>

<figure class="relative m-0 min-w-0 overflow-hidden border border-rule bg-night" aria-label="Signal strip">
	<span aria-hidden="true" class="corner size-8"></span>
	{#if points.length}
		<div class="flex items-baseline pt-4 pr-12 pb-2 pl-4 md:grid md:grid-cols-[10.5rem_minmax(0,1fr)] md:pl-0">
			<p class="label hidden text-muted md:block md:pl-6">Latest</p>
			<p class="label text-muted">Last {points.length} readings, oldest on the left</p>
		</div>
		<div
			class="inspector cursor-crosshair touch-pan-y select-none"
			role="slider"
			tabindex="0"
			aria-label="Reading inspector"
			aria-orientation="horizontal"
			aria-valuemin={0}
			aria-valuemax={latest}
			aria-valuenow={index}
			aria-valuetext={valuetext}
			aria-describedby={`${uid}-help`}
			onpointermove={inspect}
			onpointerdown={inspect}
			onpointerleave={release}
			onkeydown={step}
		>
			{#each lanes as lane, laneIndex (lane.field)}
				{@const now = value(points[latest]?.row, lane.field)}
				<div class={['grid border-white/20 md:grid-cols-[10.5rem_minmax(0,1fr)]', laneIndex > 0 && 'md:border-t']}>
					<div class="grid grid-cols-[1fr_auto] items-end gap-x-3 px-4 pt-3 pb-2 md:block md:pt-3 md:pr-4 md:pl-6">
						<p class="label flex items-center gap-2 text-white"><span aria-hidden="true" class="h-[3px] w-5" style:background={lane.pen}></span>{lane.label}</p>
						<p class={['row-span-2 self-center leading-none md:mt-2', now === 'No value' ? 'text-[15px] font-medium text-muted' : 'text-[30px] [font-weight:800] [font-stretch:112%]']}>{now}</p>
						{#if lane.range}<p class="text-[12px] text-muted tabular-nums md:mt-2">Range {number(lane.range.min)} to {number(lane.range.max)}</p>{/if}
					</div>
					<div class="chart-grid relative h-[120px] min-w-0">
						{#if lane.chart.validCount}
							<svg class="absolute inset-0 block" {width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
								{#if band}
									<rect class="band" x={band.x} width={band.w} y="0" height={HEIGHT} />
									<line class="band-edge" x1={band.x} x2={band.x} y1="0" y2={HEIGHT} />
									<line class="band-edge" x1={band.x + band.w} x2={band.x + band.w} y1="0" y2={HEIGHT} />
								{/if}
								{#if inspecting}
									<line class="cursor" x1={points[index].x} x2={points[index].x} y1="0" y2={HEIGHT} />
								{/if}
								<path class="trace" d={lane.chart.path} pathLength="1" style:stroke={lane.pen} style:--lane={laneIndex} />
								{#each lane.isolated as point (point.row.id)}
									<circle cx={point.x} cy={point.y} r="2.5" style:fill={lane.pen} />
								{/each}
								{#if lane.head}
									<circle class="head" cx={lane.head.x} cy={lane.head.y} r="4" style:fill={lane.pen} style:--lane={laneIndex} />
								{/if}
								{#if inspecting && lane.chart.points[index]?.y != null}
									<circle class="marker" cx={lane.chart.points[index].x} cy={lane.chart.points[index].y} r="4.5" style:fill={lane.pen} />
								{/if}
							</svg>
						{:else}
							<p class="absolute inset-0 grid place-items-center px-4 text-center text-[15px] text-muted">No {lane.label} values in these readings.</p>
						{/if}
						{#if laneIndex === 0 && band}
							<span aria-hidden="true" class="absolute top-1 grid size-5 -translate-x-1/2 place-items-center bg-lime text-night" style:left={`${band.x + band.w / 2}px`}><band.Icon size={14} strokeWidth={2.75} /></span>
						{/if}
					</div>
				</div>
			{/each}
			<div class="grid md:grid-cols-[10.5rem_minmax(0,1fr)]">
				<div aria-hidden="true"></div>
				<div class="relative h-8 border-t border-white/20 text-[12px] text-muted tabular-nums" data-axis bind:clientWidth={width}>
					{#each lanes[0].chart.xTicks as mark, tickIndex (mark.value)}
						<span class="absolute top-2 whitespace-nowrap" style:left={`${(mark.x / width) * 100}%`} style:translate={lanes[0].chart.xTicks.length === 1 ? '-50%' : tickIndex === 0 ? '0' : tickIndex === lanes[0].chart.xTicks.length - 1 ? '-100%' : '-50%'}>{time(mark.value, tickDigits)}</span>
					{/each}
				</div>
			</div>
		</div>
		<div class="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule px-4 py-3 text-[14px] md:px-6">
			<p><span class="label text-lime">{inspecting ? 'Inspecting' : 'Latest'}</span> <span class="ml-1 tabular-nums">{row ? `${time(row.created_at, 3)}, record ${row.id}` : ''}</span></p>
			<p class="flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
				{#each lanes as lane (lane.field)}
					<span class="flex items-center gap-1.5 text-muted"><span aria-hidden="true" class="h-[3px] w-3" style:background={lane.pen}></span>{lane.label} <strong class="font-bold text-white">{value(row, lane.field)}</strong></span>
				{/each}
			</p>
		</div>
		<p id={`${uid}-help`} class="px-4 pb-4 text-[13px] leading-relaxed text-muted md:px-6">Hover, tap or use the arrow keys to read all three signals at one moment. Press Escape to go back to the latest reading.</p>
	{:else}
		<div class="chart-grid grid min-h-[280px] place-items-center px-6 py-12 text-center">
			<div class="max-w-sm">
				<p class="display text-[22px]">{unavailable ? 'No readings loaded' : 'No readings yet'}</p>
				<p class="mt-3 text-[15px] leading-relaxed text-muted">{unavailable ? 'Your signals appear here once the connection is back.' : 'Start recording on your sensor. New readings appear here within 5 seconds.'}</p>
			</div>
		</div>
	{/if}
</figure>

<style>
	.band { fill: #fff; opacity: 0.14; animation: band-in 150ms ease-out both; }
	.band-edge { stroke: var(--color-lime); stroke-width: 1.5; }
	.cursor { stroke: #fff; stroke-opacity: 0.55; stroke-width: 1; }
	.trace { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; stroke-dasharray: 1; animation: pen-write 900ms cubic-bezier(0.2, 0.7, 0.2, 1) both; animation-delay: calc(var(--lane) * 60ms); }
	.head { stroke: var(--color-night); stroke-width: 2; transition: cy 200ms ease-out; animation: head-in 200ms ease-out both; animation-delay: calc(900ms + var(--lane) * 60ms); }
	.marker { stroke: var(--color-night); stroke-width: 2; }
	/* The plot panels are positioned, so an outline on the slider would sit underneath them; draw the ring on a layer above. */
	.inspector { position: relative; }
	.inspector:focus-visible { outline: none; }
	.inspector:focus-visible::after { content: ''; position: absolute; inset: 0; z-index: 1; border: 2px solid var(--color-lime); pointer-events: none; }
	@keyframes pen-write { from { stroke-dashoffset: 1; } }
	@keyframes head-in { from { opacity: 0; } }
	@keyframes band-in { from { opacity: 0; } }
</style>
