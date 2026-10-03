import type { Reading } from './readings';

export type SensorField = 'ekg' | 'emg' | 'puls';
export type Plot = { left: number; right: number; top: number; bottom: number; width: number; height: number };
export const plot: Plot = { left: 58, right: 332, top: 20, bottom: 178, width: 350, height: 224 };

// `minSpan` stops a few units of change (such as BPM) filling the whole height; `floor` pins the bottom of
// the scale for values that start there, such as an activity envelope at zero.
export type Scale = { minSpan?: number; floor?: number };

// `field` can be a function for derived values.
export function chartData(readings: Reading[], field: SensorField | ((row: Reading) => number | null), frame: Plot = plot, { minSpan = 0, floor }: Scale = {}) {
	const read = typeof field === 'function' ? field : (row: Reading) => row[field];
	const ordered = readings.filter((row) => Number.isFinite(Date.parse(row.created_at)))
		.slice().sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
	const raw = ordered.map((row) => read(row));
	const values = raw.filter((value): value is number => value !== null && Number.isFinite(value));
	const min = values.length ? Math.min(...values) : 0;
	const max = values.length ? Math.max(...values) : 1;
	const padding = min === max ? Math.max(Math.abs(min) * 0.1, 1) : (max - min) * 0.1;
	const pinned = floor !== undefined && min >= floor;
	const widen = Math.max(minSpan - (max - min) - 2 * padding, 0) / 2;
	const low = pinned ? floor : min - padding - widen;
	const high = pinned ? Math.max(max + padding, floor + minSpan) : max + padding + widen;
	const start = ordered.length ? Date.parse(ordered[0].created_at) : 0;
	const end = ordered.length ? Date.parse(ordered[ordered.length - 1].created_at) : 0;
	const points = ordered.map((row, index) => {
		const value = raw[index];
		return {
			row,
			x: start === end ? (frame.left + frame.right) / 2 : frame.left + (Date.parse(row.created_at) - start) / (end - start) * (frame.right - frame.left),
			y: value !== null && Number.isFinite(value) ? frame.bottom - (value - low) / (high - low) * (frame.bottom - frame.top) : null
		};
	});
	// A capture pause longer than both one second and five typical sample intervals is a gap, not a slope.
	const times = ordered.map((row) => Date.parse(row.created_at));
	const spacing = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
	const gapLimit = Math.max(1000, (spacing[Math.floor(spacing.length / 2)] ?? 0) * 5);
	let drawing = false;
	const commands = points.map((point, index) => {
		if (point.y === null) { drawing = false; return ''; }
		const command = drawing && times[index] - times[index - 1] <= gapLimit ? 'L' : 'M';
		drawing = true;
		return command;
	});
	const path = points.map((point, index) => commands[index] && `${commands[index]}${point.x},${point.y}`).join(' ');
	return {
		points, path, validCount: values.length,
		// Single readings between gaps draw no line, so callers mark them separately.
		isolated: points.filter((_, index) => commands[index] === 'M' && commands[index + 1] !== 'L'),
		yTicks: [high, (low + high) / 2, low].map((value) => ({ value, y: frame.bottom - (value - low) / (high - low) * (frame.bottom - frame.top) })),
		xTicks: start === end ? [{ value: start, x: (frame.left + frame.right) / 2 }] : [start, (start + end) / 2, end].map((value) => ({ value, x: frame.left + (value - start) / (end - start) * (frame.right - frame.left) }))
	};
}
