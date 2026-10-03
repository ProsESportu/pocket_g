<script lang="ts">
	import type { Reading } from './readings';
	import { chartData, plot, type SensorField } from './chart';
	let { readings, field, label, color }: { readings: Reading[]; field: SensorField; label: string; color: string } = $props();
	let selectedId = $state<number | null>(null);
	const uid = $props.id();
	let chart = $derived(chartData(readings, field));
	let selectedIndex = $derived.by(() => {
		const index = chart.points.findIndex((point) => point.row.id === selectedId);
		return index >= 0 ? index : chart.points.length - 1;
	});
	let selected = $derived(chart.points[selectedIndex]);
	const time = (value: number) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZone: 'Europe/Warsaw' }).format(value);
	const date = (value: string) => new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, timeZone: 'Europe/Warsaw' }).format(new Date(value));
	const number = (value: number) => new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 4 }).format(value);
	let details = $derived(selected ? `Record #${selected.row.id}, ${date(selected.row.created_at)}, ${label}: ${selected.row[field] ?? 'Missing value'}` : 'No readings');
	function selectPoint(event: PointerEvent) {
		const svg = (event.currentTarget as HTMLElement).querySelector('svg');
		if (!svg || !chart.points.length) return;
		const bounds = svg.getBoundingClientRect();
		const x = (event.clientX - bounds.left) / bounds.width * plot.width;
		const closest = chart.points.reduce((best, point) => Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best);
		selectedId = closest.row.id;
	}
	function selectWithKeyboard(event: KeyboardEvent) {
		let index = selectedIndex;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') index--;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') index++;
		else if (event.key === 'Home') index = 0;
		else if (event.key === 'End') index = chart.points.length - 1;
		else return;
		event.preventDefault();
		selectedId = chart.points[Math.max(0, Math.min(index, chart.points.length - 1))]?.row.id ?? null;
	}
</script>

<article class="chart-card" style:--sensor-color={color} aria-labelledby={`${uid}-title`}>
	<div class="chart-heading"><h3 id={`${uid}-title`}><span class="sensor-dot" aria-hidden="true"></span>{label}</h3><span>{chart.validCount} values</span></div>
	<p class="chart-caption">Raw value · independent scale</p>
	{#if chart.validCount}
		<div class="chart-selector" role="slider" tabindex="0" aria-label={`${label} reading selector`} aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={chart.points.length - 1} aria-valuenow={selectedIndex} aria-valuetext={details} aria-describedby={`${uid}-help`} onpointermove={selectPoint} onpointerdown={selectPoint} onkeydown={selectWithKeyboard}>
			<svg viewBox={`0 0 ${plot.width} ${plot.height}`} aria-hidden="true">
				{#each chart.yTicks as tick}
					<line class="chart-gridline" x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} />
					<text class="chart-axis-text" x={plot.left - 8} y={tick.y + 4} text-anchor="end">{number(tick.value)}</text>
				{/each}
				<path d={chart.path} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" />
				{#each chart.points as point (point.row.id)}
					{#if point.y !== null}<circle cx={point.x} cy={point.y} r="2.5" fill={color} />{/if}
				{/each}
				{#if selected}
					<line x1={selected.x} x2={selected.x} y1={plot.top} y2={plot.bottom} stroke={color} stroke-dasharray="3 4" opacity="0.45" />
					{#if selected.y !== null}<circle cx={selected.x} cy={selected.y} r="5" fill={color} stroke="white" stroke-width="2" />{/if}
				{/if}
				{#each chart.xTicks as tick, index}
					<text class="chart-axis-text" x={tick.x} y={plot.bottom + 21} text-anchor={chart.xTicks.length === 1 ? 'middle' : index === 0 ? 'start' : index === chart.xTicks.length - 1 ? 'end' : 'middle'}>{time(tick.value)}</text>
				{/each}
				<text class="chart-axis-text" x={(plot.left + plot.right) / 2} y={plot.height - 4} text-anchor="middle">Time (Warsaw)</text>
			</svg>
		</div>
		<div class="chart-details"><strong>{label}: {selected?.row[field] ?? 'Missing value'}</strong><span>{selected ? `#${selected.row.id} · ${date(selected.row.created_at)}` : ''}</span></div>
		<p id={`${uid}-help`} class="chart-help">Hover or tap to inspect. Use arrow keys when focused.</p>
	{:else}
		<div class="chart-empty"><p>{readings.length ? `No ${label} values to plot` : 'No readings to plot yet'}</p><span>Values appear here after a successful refresh.</span></div>
	{/if}
</article>
