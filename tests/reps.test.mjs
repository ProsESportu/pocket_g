import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReps, displayedSet, principalAxis, offAxisShare, axisAngle } from '../src/lib/reps.ts';
import { estimateGyroEnergy } from '../src/lib/gyro-energy.ts';
import { curlRows, curls } from './imu-fixture.mjs';

test('counts eight slow curls with range and lifting/lowering times', () => {
	const [set] = analyzeReps(curlRows({ reps: curls(8, { range: 130, up: 1, down: 1.2 }) }));
	assert.equal(set.status, 'completed');
	assert.equal(set.reps.length, 8);
	for (const rep of set.reps) {
		assert.ok(rep.rangeDeg > 110 && rep.rangeDeg < 140, `range ${rep.rangeDeg}`);
		assert.ok(Math.abs(rep.upSeconds - 1) <= 0.2, `up ${rep.upSeconds}`);
		assert.ok(Math.abs(rep.downSeconds - 1.2) <= 0.2, `down ${rep.downSeconds}`);
		assert.ok(rep.endMs > rep.startMs && rep.lastRecordId > rep.firstRecordId);
	}
	assert.deepEqual(set.reps.map((rep) => rep.rep), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('half curls measure about half the range', () => {
	const [set] = analyzeReps(curlRows({ reps: [...curls(4, { range: 130 }), ...curls(4, { range: 60 })] }));
	assert.equal(set.reps.length, 8);
	assert.ok(set.reps.slice(0, 4).every((rep) => rep.rangeDeg > 110));
	assert.ok(set.reps.slice(4).every((rep) => rep.rangeDeg > 45 && rep.rangeDeg < 65), set.reps.map((rep) => rep.rangeDeg.toFixed(0)).join());
});

test('set boundaries and numbers match the energy panel', () => {
	const first = curlRows({ reps: curls(3), restAfter: 7 });
	const second = curlRows({ reps: curls(2), startId: first.at(-1).id + 1, origin: Date.parse(first.at(-1).created_at) + 200 });
	const rows = [...first, ...second];
	const sets = analyzeReps(rows), energy = estimateGyroEnergy(rows, { massKg: 1, pivot: 'elbow', elbowCm: 35, shoulderCm: 65 }).sets;
	assert.deepEqual(sets.map(({ set, status, firstRecordId, lastRecordId }) => ({ set, status, firstRecordId, lastRecordId })),
		energy.map(({ set, status, firstRecordId, lastRecordId }) => ({ set, status, firstRecordId, lastRecordId })));
	assert.deepEqual(sets.map((set) => set.reps.length), [3, 2]);
	assert.equal(displayedSet(sets).set, 2);
});

test('a rep counts only once the arm comes back down', () => {
	const rows = curlRows({ reps: curls(2), restAfter: 0 });
	// Cut the recording while the third curl is held near the top.
	const lifting = curlRows({ reps: [{ up: 1, down: 4 }], restBefore: 0, restAfter: 0, startId: rows.at(-1).id + 1, origin: Date.parse(rows.at(-1).created_at) + 200 }).slice(0, 7);
	const [set] = analyzeReps([...rows, ...lifting]);
	assert.equal(set.status, 'ongoing');
	assert.equal(set.reps.length, 2);
});

test('a newer set without reps does not replace the last counted set', () => {
	const rows = curlRows({ reps: curls(3), restAfter: 7 });
	const twitch = [{ ...rows.at(-1), id: rows.at(-1).id + 1, created_at: new Date(Date.parse(rows.at(-1).created_at) + 200).toISOString(), gyro_y: 0.5 }];
	const sets = analyzeReps([...rows, ...twitch]);
	assert.equal(sets.length, 2);
	assert.equal(displayedSet(sets).set, 1);
});

test('missing accelerometer values leave the set without reps', () => {
	const rows = curlRows({ reps: curls(3) }).map(({ acc_x, acc_y, acc_z, ...row }) => row);
	const [set] = analyzeReps(rows);
	assert.equal(set.reps.length, 0);
	assert.equal(displayedSet([set]), null);
});

test('rotation statistics find the hinge axis and measure twisting', () => {
	const clean = analyzeReps(curlRows({ reps: curls(3) }))[0].reps[0];
	const twisted = analyzeReps(curlRows({ reps: curls(3, { twist: 0.8 }) }))[0].reps[0];
	assert.ok(axisAngle(principalAxis(clean.scatter), [0, 1, 0]) < 1);
	assert.ok(offAxisShare(clean.scatter, [0, 1, 0]) < 0.01);
	assert.ok(offAxisShare(twisted.scatter, [0, 1, 0]) > 0.3);
});
