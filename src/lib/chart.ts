import type { Reading } from './readings';

export type SensorField = 'ekg' | 'emg' | 'puls';
export const plot = { left: 58, right: 332, top: 20, bottom: 178, width: 350, height: 224 };

export function chartData(readings: Reading[], field: SensorField) {
	const ordered = readings.filter((row) => Number.isFinite(Date.parse(row.created_at)))
		.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
	const values = ordered.map((row) => row[field]).filter((value): value is number => value !== null && Number.isFinite(value));
	const min = values.length ? Math.min(...values) : 0;
	const max = values.length ? Math.max(...values) : 1;
	const padding = min === max ? Math.max(Math.abs(min) * 0.1, 1) : (max - min) * 0.1;
	const low = min - padding;
	const high = max + padding;
	const start = ordered.length ? Date.parse(ordered[0].created_at) : 0;
	const end = ordered.length ? Date.parse(ordered[ordered.length - 1].created_at) : 0;
	const points = ordered.map((row) => ({
		row,
		x: start === end ? (plot.left + plot.right) / 2 : plot.left + (Date.parse(row.created_at) - start) / (end - start) * (plot.right - plot.left),
		y: row[field] !== null && Number.isFinite(row[field]) ? plot.bottom - (row[field]! - low) / (high - low) * (plot.bottom - plot.top) : null
	}));
	let drawing = false;
	const path = points.map((point) => {
		if (point.y === null) { drawing = false; return ''; }
		const command = drawing ? 'L' : 'M';
		drawing = true;
		return `${command}${point.x},${point.y}`;
	}).join(' ');
	return {
		points, path, validCount: values.length,
		yTicks: [high, (low + high) / 2, low].map((value) => ({ value, y: plot.bottom - (value - low) / (high - low) * (plot.bottom - plot.top) })),
		xTicks: start === end ? [{ value: start, x: (plot.left + plot.right) / 2 }] : [start, (start + end) / 2, end].map((value) => ({ value, x: plot.left + (value - start) / (end - start) * (plot.right - plot.left) }))
	};
}
