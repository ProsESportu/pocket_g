import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReps } from '../src/lib/reps.ts';
import { assessSet, buildTemplate, restoreExercises, serializeExercises } from '../src/lib/exercises.ts';
import { curlRows, curls } from './imu-fixture.mjs';

const set = (options) => analyzeReps(curlRows(options))[0];
const curl = buildTemplate('Bicep curl', set({ reps: curls(4, { range: 130, up: 1, down: 1.5 }) }).reps, '2026-10-04T12:00:00.000Z');

test('teaching needs at least three reps and a name', () => {
	assert.equal(typeof curl, 'object');
	assert.equal(curl.reps, 4);
	assert.ok(curl.rangeDeg > 110);
	assert.match(buildTemplate('Bicep curl', set({ reps: curls(2) }).reps), /Only 2 reps detected — do at least 3/);
	assert.match(buildTemplate('  ', set({ reps: curls(4) }).reps), /name/);
});

test('recognises curls, including short ones, and rejects a different hinge', () => {
	const curls8 = assessSet(set({ reps: curls(8) }), [curl]);
	assert.equal(curls8.status, 'matched');
	assert.equal(curls8.template.name, 'Bicep curl');
	assert.ok(curls8.distanceDeg < 10);
	assert.equal(assessSet(set({ reps: curls(4, { range: 60 }) }), [curl]).status, 'matched');
	const raise = assessSet(set({ reps: curls(4, { range: 90 }), axis: [0, 0, 1] }), [curl]);
	assert.equal(raise.status, 'unknown');
	assert.ok(raise.distanceDeg > 60);
	assert.equal(assessSet(set({ reps: curls(1) }), [curl]).status, 'waiting');
	assert.equal(assessSet(set({ reps: curls(4) }), []).status, 'waiting');
});

test('picks the closer of two taught exercises', () => {
	const hammer = buildTemplate('Hammer curl', set({ reps: curls(4), axis: [0, 0, 1] }).reps);
	assert.equal(assessSet(set({ reps: curls(4), axis: [0, 0, 1] }), [curl, hammer]).template.name, 'Hammer curl');
	assert.equal(assessSet(set({ reps: curls(4) }), [curl, hammer]).template.name, 'Bicep curl');
});

test('flags short, dropped, swung and twisted reps against the taught example', () => {
	const result = assessSet(set({ reps: [
		...curls(3, { range: 130, up: 1, down: 1.5 }),
		{ range: 60, up: 1, down: 1.5 },
		{ range: 130, up: 1, down: 0.4 },
		{ range: 130, up: 0.4, down: 1.5 },
		{ range: 130, up: 1, down: 1.5, twist: 0.8 }
	] }), [curl]);
	assert.deepEqual(result.checks.map((check) => check.flags), [[], [], [], ['range'], ['lowering'], ['swing'], ['twist']]);
	assert.ok(result.checks[3].rangeShortDeg > 50);
});

test('templates survive storage and reject malformed entries', () => {
	assert.deepEqual(restoreExercises(serializeExercises([curl])), [curl]);
	assert.deepEqual(restoreExercises(JSON.stringify({ version: 1, templates: [{ ...curl, axis: [0, 1] }, { ...curl, name: '' }] })), []);
	assert.deepEqual(restoreExercises('{'), []);
	assert.deepEqual(restoreExercises(null), []);
});
