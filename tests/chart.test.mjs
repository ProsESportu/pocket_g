import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chartData, plot } from '../src/lib/chart.ts';

const reading = (id, seconds, value) => ({ id, created_at: new Date(Date.UTC(2026, 9, 3, 10, 0, seconds)).toISOString(), ekg: value, emg: value, puls: value });

test('sorts timestamps without mutating readings and preserves elapsed-time spacing', () => {
	const rows = [reading(1, 10, 3), reading(3, 0, 1), reading(2, 2, 2)];
	const chart = chartData(rows, 'ekg');
	assert.deepEqual(chart.points.map((point) => point.row.id), [3, 2, 1]);
	assert.equal(chart.points[1].x, plot.left + 0.2 * (plot.right - plot.left));
	assert.deepEqual(rows.map((row) => row.id), [1, 3, 2]);
});

test('keeps zero and breaks the line at missing values', () => {
	const chart = chartData([reading(1, 0, 0), reading(2, 1, null), reading(3, 2, 10)], 'ekg');
	assert.equal(chart.validCount, 2);
	assert.notEqual(chart.points[0].y, null);
	assert.equal(chart.points[1].y, null);
	assert.equal((chart.path.match(/M/g) ?? []).length, 2);
	assert.equal((chart.path.match(/L/g) ?? []).length, 0);
});

test('empty, missing, single and constant values produce finite coordinates', () => {
	for (const rows of [[], [reading(1, 0, null)], [reading(1, 0, 0)], [reading(1, 0, -3), reading(2, 0, -3)]]) {
		const chart = chartData(rows, 'ekg');
		for (const point of chart.points) {
			assert.ok(Number.isFinite(point.x));
			assert.ok(point.y === null || Number.isFinite(point.y));
		}
		assert.ok(chart.yTicks.every((tick) => Number.isFinite(tick.y)));
		assert.doesNotMatch(chart.path, /NaN|Infinity/);
	}
	assert.equal(chartData([reading(1, 0, 0)], 'ekg').points[0].x, (plot.left + plot.right) / 2);
});

test('sensor scales are independent and invalid timestamps or nonfinite values are excluded', () => {
	const rows = [reading(1, 0, 1), { ...reading(2, 1, 2), emg: 200 }, { ...reading(3, 2, 3), created_at: 'invalid' }, reading(4, 3, Infinity)];
	const ekg = chartData(rows, 'ekg');
	const emg = chartData(rows, 'emg');
	assert.equal(ekg.points.length, 3);
	assert.equal(ekg.validCount, 2);
	assert.equal(ekg.points[2].y, null);
	assert.ok(emg.yTicks[0].value > ekg.yTicks[0].value);
});
