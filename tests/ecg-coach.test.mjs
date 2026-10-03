import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ecgCoachNotes, NORMAL_ECG_LABELS } from '../src/lib/ecg-coach.ts';
import { parseLabels } from '../src/lib/ecg.ts';

const labels = parseLabels(readFileSync(new URL('../static/models/ecgfounder/tasks.txt', import.meta.url), 'utf8'));
const result = (scores) => ({ status: 'ready', scores, window: { firstRecordId: 100, lastRecordId: 200,
	startedAt: '2026-10-03T10:00:00Z', endedAt: '2026-10-03T10:00:40Z' } });
const score = (label, value) => ({ index: labels.indexOf(label), label, score: value });

test('all 146 non-normal labels are eligible, with no truncation and stable model-index IDs', () => {
	const input = result(labels.map((label, index) => ({ index, label, score: 1 })));
	const notes = ecgCoachNotes(input, []);
	assert.equal(notes.length, 146);
	assert.deepEqual(notes.map((note) => note.id), input.scores.filter((row) => !NORMAL_ECG_LABELS.has(row.label)).map((row) => `ecg-${row.index}`));
});

test('individual findings are independent of ABNORMAL ECG and include the 80% boundary', () => {
	const input = result([score('ABNORMAL ECG', .1), score('ATRIAL FIBRILLATION', .8), score('PROLONGED QT', .95),
		score('SINUS BRADYCARDIA', .799999), score('SINUS TACHYCARDIA', .8)]);
	const notes = ecgCoachNotes(input, []);
	assert.deepEqual(notes.map((note) => note.id), ['ecg-80', 'ecg-5', 'ecg-6']);
	assert.match(notes[1].text, /ATRIAL FIBRILLATION.*80\.00%/);
});

test('normal outputs are excluded exactly; fragments and comparisons remain literal with context', () => {
	const input = result([...NORMAL_ECG_LABELS].map((label) => score(label, .99)).concat([
		score('ACUTE', .9), score('ST MORE DEPRESSED IN', .9), score('BORDERLINE ECG', .9)]));
	const notes = ecgCoachNotes(input, []);
	assert.equal(notes.length, 3);
	for (const note of notes) assert.match(note.text, /Unvalidated.*requires clinical context.*no previous recording was compared/);
	assert.ok(notes.some((note) => note.text.includes('ECG model output: ACUTE —')));
	assert.ok(notes.some((note) => note.text.includes('ST MORE DEPRESSED IN')));
});

test('notes clip strip links to the visible overlap, retain timestamps, and label stale snapshots', () => {
	const input = result([score('ATRIAL FIBRILLATION', .9)]);
	const [note] = ecgCoachNotes(input, [{ id: 220 }, { id: 200 }, { id: 190 }, { id: 99 }], true);
	assert.equal(note.fromId, 190); assert.equal(note.toId, 200);
	assert.equal(note.from, input.window.startedAt); assert.equal(note.to, input.window.endedAt);
	assert.match(note.text, /^Stale snapshot.*records 100–200/);
	assert.equal(ecgCoachNotes(input, [{ id: 300 }])[0].fromId, undefined);
	assert.equal(ecgCoachNotes(input, [{ id: 300 }])[0].toId, undefined);
});

test('absent, unavailable, and successful clear results remove findings', () => {
	assert.deepEqual(ecgCoachNotes(null, []), []);
	assert.deepEqual(ecgCoachNotes({ ...result([score('ATRIAL FIBRILLATION', .9)]), status: 'unavailable' }, []), []);
	assert.deepEqual(ecgCoachNotes(result([score('ATRIAL FIBRILLATION', .79)]), []), []);
});
