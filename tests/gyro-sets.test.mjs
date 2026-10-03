import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultGyroSettings, estimateGyroEnergy } from '../src/lib/gyro-energy.ts';

const origin = Date.UTC(2026, 9, 3, 12);
const settings = { ...defaultGyroSettings(), massKg: 2, elbowCm: 100 };
const recording = (speeds) => speeds.map((speed, i) => ({
	id: i + 1, created_at: new Date(origin + i * 250).toISOString(),
	gyro_x: speed, gyro_y: 0, gyro_z: 0
}));
const rest = (length) => Array(length).fill(0);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
const sum = (result) => result.sets.reduce((total, set) => total + set.workJ, 0);

test('splits sets after five recorded seconds of smoothed rest and reconciles every work increment', () => {
	const rows = recording([0, 2, 4, ...rest(34), 2, 4]);
	const result = estimateGyroEnergy(rows, settings);
	assert.equal(result.sets.length, 2);
	assert.equal(result.sets[0].status, 'completed');
	assert.equal(result.sets[1].status, 'ongoing');
	assert.equal(result.sets[1].firstRecordId, rows.at(-2).id);
	assert.equal(result.sets[1].lastRecordId, rows.at(-1).id);
	close(result.sets[1].durationSeconds, 0.25);
	assert.ok(result.sets.every((set) => set.workJ > 0));
	close(sum(result), result.workJ);
	// Preserve the rise from the preceding rest sample rather than treating the new set as a new baseline.
	assert.ok(result.sets[1].workJ > estimateGyroEnergy(rows.slice(-2), settings).workJ);
});

test('short pauses stay within one set and an unfinished rest does not claim the set is complete', () => {
	const rows = recording([0, 2, 4, ...rest(12), 2, 4, ...rest(12)]);
	const result = estimateGyroEnergy(rows, settings);
	assert.equal(result.sets.length, 1);
	assert.equal(result.sets[0].status, 'ongoing');
	assert.ok(result.sets[0].durationSeconds > 3);
	assert.ok(result.sets[0].lastRecordId < rows.at(-1).id);
	close(sum(result), result.workJ);
});

test('completed set boundaries remain stable as later recorded rest arrives', () => {
	const first = estimateGyroEnergy(recording([0, 2, 4, ...rest(34)]), settings);
	const later = estimateGyroEnergy(recording([0, 2, 4, ...rest(45)]), settings);
	assert.deepEqual(first.sets, later.sets);
	assert.equal(first.sets[0].status, 'completed');
	assert.ok(first.sets[0].durationSeconds < first.durationSeconds - 5);
});

test('set closure uses capture time and preserves the five-second boundary at microsecond precision', () => {
	const input = recording([0, 2, ...rest(6)]).map((row, i) => ({
		...row, created_at: new Date(origin + i * 1000).toISOString().replace('.000Z', '.000100Z')
	}));
	// The first below-threshold smoothed reading is at t=2; t=7 supplies five seconds of rest.
	assert.equal(estimateGyroEnergy(input.slice(0, -1), settings).sets[0].status, 'ongoing');
	const before = input.map((row, i) => i === input.length - 1 ? { ...row, created_at: row.created_at.replace('.000100Z', '.000099Z') } : row);
	assert.equal(estimateGyroEnergy(before, settings).sets[0].status, 'ongoing');
	assert.equal(estimateGyroEnergy(input, settings).sets[0].status, 'completed');
	const after = input.map((row, i) => i === input.length - 1 ? { ...row, created_at: row.created_at.replace('.000100Z', '.000101Z') } : row);
	assert.equal(estimateGyroEnergy(after, settings).sets[0].status, 'completed');
});

test('invalid samples and discontinuities interrupt a set without bridging work or counting missing time as rest', () => {
	const rows = recording([0, 2, 4, 2, 4]);
	const variants = [
		rows.map((row, i) => i === 3 ? { ...row, gyro_x: null } : row),
		rows.map((row, i) => i >= 3 ? { ...row, id: row.id + 1 } : row),
		rows.map((row, i) => i === 3 ? { ...row, created_at: rows[2].created_at } : row),
		rows.map((row, i) => i >= 3 ? { ...row, created_at: new Date(origin + i * 250 + 6000).toISOString() } : row)
	];
	for (const input of variants) {
		const result = estimateGyroEnergy(input, settings);
		assert.equal(result.sets[0].status, 'interrupted');
		assert.ok(result.sets.length >= 2);
		assert.equal(result.sets.at(-1).status, 'ongoing');
		close(sum(result), result.workJ);
	}
});

test('stationary sessions create no sets and constant-speed movement is a real zero-work set', () => {
	assert.deepEqual(estimateGyroEnergy(recording(rest(35)), settings).sets, []);
	const result = estimateGyroEnergy(recording([2, 2, 2]), settings);
	assert.equal(result.sets.length, 1);
	assert.equal(result.sets[0].workJ, 0);
	assert.equal(result.sets[0].status, 'ongoing');
	close(result.sets[0].durationSeconds, 0.5);
	assert.deepEqual(estimateGyroEnergy([], settings).sets, []);
	assert.deepEqual(estimateGyroEnergy(recording([2]), defaultGyroSettings()).sets, []);
});

test('mass and pivot settings scale every set while preserving set detection and session reconciliation', () => {
	const input = recording([0, 2, 4, ...rest(34), 2, 4]);
	const first = estimateGyroEnergy(input, settings);
	for (const next of [{ ...settings, massKg: 4 }, { ...settings, pivot: 'shoulder', shoulderCm: 200 }]) {
		const result = estimateGyroEnergy(input, next);
		const ratio = next.massKg === 4 ? 2 : 4;
		assert.equal(result.sets.length, first.sets.length);
		result.sets.forEach((set, i) => {
			close(set.workJ, first.sets[i].workJ * ratio);
			assert.deepEqual({ ...set, workJ: 0 }, { ...first.sets[i], workJ: 0 });
		});
		close(sum(result), result.workJ);
	}
});
