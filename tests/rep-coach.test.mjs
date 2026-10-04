import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReps } from '../src/lib/reps.ts';
import { assessSet, buildTemplate } from '../src/lib/exercises.ts';
import { formCoachNotes, repList } from '../src/lib/rep-coach.ts';
import { curlRows, curls } from './imu-fixture.mjs';

const curl = buildTemplate('Bicep curl', analyzeReps(curlRows({ reps: curls(4, { down: 1.5 }) }))[0].reps);

test('lists reps as ranges', () => {
	assert.equal(repList([6, 7, 8]), 'reps 6–8');
	assert.equal(repList([2]), 'rep 2');
	assert.equal(repList([2, 5, 7]), 'reps 2, 5 and 7');
	assert.equal(repList([5, 2, 3]), 'reps 2–3 and 5');
});

test('one note per set names the flagged reps, with times but no strip record IDs', () => {
	const sets = analyzeReps(curlRows({ reps: [...curls(5, { down: 1.5 }), ...curls(3, { range: 60, down: 1.5 })] }));
	const [note] = formCoachNotes(sets, sets.map((set) => assessSet(set, [curl])));
	assert.equal(note.kind, 'try');
	assert.match(note.text, /^Set 1 compared with your taught Bicep curl: reps 6–8 had about \d+° less range\.$/);
	assert.equal(note.from, sets[0].startedAt);
	assert.equal(note.fromId, undefined);
});

test('a clean finished set gets a keep note; unknown and untaught sets get none', () => {
	const sets = analyzeReps(curlRows({ reps: curls(6, { down: 1.5 }) }));
	assert.deepEqual(formCoachNotes(sets, sets.map((set) => assessSet(set, [curl]))).map((note) => [note.kind, note.text]),
		[['keep', 'Set 1: all 6 reps matched your taught Bicep curl.']]);
	assert.deepEqual(formCoachNotes(sets, sets.map((set) => assessSet(set, []))), []);
	const raise = analyzeReps(curlRows({ reps: curls(4), axis: [0, 0, 1] }));
	assert.deepEqual(formCoachNotes(raise, raise.map((set) => assessSet(set, [curl]))), []);
});
