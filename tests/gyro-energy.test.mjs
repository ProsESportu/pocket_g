import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGyroSettings, estimateGyroEnergy, restoreGyroSession, serializeGyroSession } from '../src/lib/gyro-energy.ts';

const origin = Date.UTC(2026, 9, 3, 12);
const row = (id, x = 0, y = 0, z = 0, milliseconds = (id - 1) * 250) => ({ id, created_at: new Date(origin + milliseconds).toISOString(), gyro_x: x, gyro_y: y, gyro_z: z });
const settings = { ...defaultGyroSettings(), massKg: 2, elbowCm: 100 };
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('smooths radians/s with actual elapsed time and accumulates only positive changes', () => {
	const input = [row(1), row(2, 2), row(3), row(4)];
	const result = estimateGyroEnergy(input, settings);
	const peak = 2 * (1 - Math.exp(-1));
	close(result.workJ, peak ** 2);
	close(result.latestKineticJ, (peak * Math.exp(-2)) ** 2);
	assert.equal(result.sampleCount, 4);
	close(result.durationSeconds, 0.75);
	assert.equal(result.segmentCount, 1);
	assert.deepEqual(input, [row(1), row(2, 2), row(3), row(4)]);
});

test('kinetic energy uses all axes; constant speed adds no work', () => {
	const result = estimateGyroEnergy([row(1, 1, 2, 2), row(2, 1, 2, 2), row(3, 1, 2, 2)], settings);
	close(result.latestKineticJ, 9);
	close(result.workJ, 0);
});

test('mass scales linearly and elbow/shoulder toggles scale the whole recording by distance squared', () => {
	const input = [row(1), row(2, 2), row(3, 4)];
	const elbow = { ...defaultGyroSettings(), massKg: 5 };
	const first = estimateGyroEnergy(input, elbow);
	const shoulder = estimateGyroEnergy(input, { ...elbow, pivot: 'shoulder' });
	close(shoulder.workJ / first.workJ, (65 / 35) ** 2);
	close(shoulder.latestKineticJ / first.latestKineticJ, (65 / 35) ** 2);
	close(estimateGyroEnergy(input, { ...elbow, massKg: 10 }).workJ, first.workJ * 2);
	close(estimateGyroEnergy(input, { ...elbow, elbowCm: 70 }).workJ, first.workJ * 4);
	assert.deepEqual(estimateGyroEnergy(input, elbow), first);
});

test('the rest threshold suppresses stationary jitter', () => {
	const result = estimateGyroEnergy([row(1, 0.01), row(2, 0.04), row(3, -0.02)], settings);
	assert.equal(result.latestKineticJ, 0);
	assert.equal(result.workJ, 0);
	close(estimateGyroEnergy([row(1, 0.05)], settings).latestKineticJ, 0.05 ** 2);
});

test('gaps, repeated/backward timestamps and missing IDs establish new baselines', () => {
	for (const next of [row(3, 100), row(2, 100, 0, 0, 0), row(2, 100, 0, 0, -1), row(2, 100, 0, 0, 2001)]) {
		const result = estimateGyroEnergy([row(1), next], settings);
		assert.equal(result.workJ, 0);
		assert.equal(result.segmentCount, 2);
		assert.equal(result.durationSeconds, 0);
	}
});

test('invalid gyro samples and timestamps are skipped without bridging their neighbors', () => {
	for (const bad of [{ ...row(2), gyro_x: null }, { ...row(2), gyro_y: Infinity }, { ...row(2), gyro_z: NaN }, { ...row(2), created_at: 'invalid' }]) {
		const result = estimateGyroEnergy([row(1), bad, row(3, 100)], settings);
		assert.equal(result.workJ, 0);
		assert.equal(result.sampleCount, 2);
		assert.equal(result.skippedCount, 1);
		assert.equal(result.segmentCount, 2);
		assert.equal(estimateGyroEnergy([bad], settings).status, 'unavailable');
		assert.equal(estimateGyroEnergy([row(1, 2), bad], settings).latestKineticJ, null);
	}
});

test('preserves microsecond timing, does not count the initial kinetic energy and reports the analyzed range', () => {
	const input = [
		{ ...row(1), created_at: '2026-10-03T12:00:00.000100Z' },
		{ ...row(2, 1), created_at: '2026-10-03T12:00:00.000200Z' }
	];
	const result = estimateGyroEnergy(input, settings);
	assert.equal(result.segmentCount, 1);
	assert.ok(result.durationSeconds > 0 && result.durationSeconds < 0.001);
	assert.equal(result.firstRecordId, 1);
	assert.equal(result.lastRecordId, 2);
	assert.equal(result.startedAt, input[0].created_at);
	assert.equal(estimateGyroEnergy([row(1, 100)], settings).workJ, 0);
});

test('handles empty sessions, invalid mass/distances and overflow without displaying fabricated energy', () => {
	assert.equal(estimateGyroEnergy([], settings).status, 'empty');
	for (const massKg of [null, 0, -1, NaN, Infinity]) assert.equal(estimateGyroEnergy([row(1)], { ...settings, massKg }).status, 'unset');
	for (const elbowCm of [0, -1, NaN, Infinity]) assert.equal(estimateGyroEnergy([row(1)], { ...settings, elbowCm }).status, 'unset');
	assert.equal(estimateGyroEnergy([row(1, 1e308)], settings).status, 'unavailable');
});

test('tab persistence retains mass, selected pivot, both distance overrides and reset boundary', () => {
	const settings = { massKg: 7.5, pivot: 'shoulder', elbowCm: 40, shoulderCm: 72 };
	assert.deepEqual(restoreGyroSession(serializeGyroSession(settings, 376)), { settings, baselineId: 376 });
	assert.deepEqual(restoreGyroSession(null), { settings: defaultGyroSettings(), baselineId: null });
	for (const bad of ['broken JSON', 'null', '{}', serializeGyroSession({ ...settings, massKg: -1 }, 1), serializeGyroSession(settings, -1)]) {
		assert.deepEqual(restoreGyroSession(bad), restoreGyroSession(null));
	}
	assert.equal(restoreGyroSession(serializeGyroSession(settings, 0)).baselineId, 0);
});
