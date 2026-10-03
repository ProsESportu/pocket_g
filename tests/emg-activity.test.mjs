import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emgActivity } from '../src/lib/emg-activity.ts';

const origin = Date.UTC(2026, 9, 3, 19, 36, 0);
// 125 Hz samples; `value(i)` gives the EMG reading for sample i.
const rows = (count, value, spacing = 8) => Array.from({ length: count }, (_, i) => ({ id: i + 1, created_at: new Date(origin + i * spacing).toISOString(), emg: value(i) }));

test('a constant signal has no activity', () => {
	const activity = emgActivity(rows(500, () => 512));
	assert.equal(activity.size, 500);
	assert.ok([...activity.values()].every((value) => Math.abs(value) < 1e-9));
});

test('a burst of alternating values rises well above the quiet stretch around it', () => {
	// Quiet for 2 s, a 1 s burst swinging ±200, then quiet again.
	const activity = emgActivity(rows(625, (i) => 500 + (i >= 250 && i < 375 ? (i % 2 ? 200 : -200) : (i % 2 ? 3 : -3))));
	assert.ok(activity.get(313) > 150, String(activity.get(313)));
	assert.ok(activity.get(60) < 10, String(activity.get(60)));
	assert.ok(activity.get(560) < 10, String(activity.get(560)));
});

test('missing values and capture gaps leave holes and restart the envelope', () => {
	const data = rows(400, (i) => 500 + (i % 2 ? 50 : -50));
	data[100].emg = null;
	data[101].emg = Number.NaN;
	for (const row of data.slice(300)) row.created_at = new Date(Date.parse(row.created_at) + 5000).toISOString();
	const activity = emgActivity(data);
	assert.equal(activity.has(101), false);
	assert.equal(activity.has(102), false);
	assert.equal(activity.size, 398);
	// Each run is measured on its own, so values on both sides of the gap stay comparable.
	assert.ok(Math.abs(activity.get(300) - activity.get(301)) < 15);
	assert.equal(emgActivity([]).size, 0);
});
