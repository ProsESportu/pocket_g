import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signalChecks } from '../src/lib/coach.ts';
import { pulseConfiguration } from '../src/lib/pulse.ts';

const at = (id) => new Date(Date.UTC(2026, 9, 3, 10, 0, id)).toISOString();
const rows = (count, overrides = {}) => Array.from({ length: count }, (_, index) => ({ id: index + 1, created_at: at(index), ekg: 1, emg: 2, puls: 3, ...overrides[index + 1] }));
const unavailable = (duration = 0) => ({ ...pulseConfiguration(null), status: 'unavailable', duration });
const ready = (firstRecordId, lastRecordId) => ({ ...unavailable(9.8), status: 'ready', bpm: 72, hz: 1.2, beatCount: 11, firstRecordId, lastRecordId });

test('needs enough readings before giving notes', () => {
	assert.deepEqual(signalChecks(rows(9), ready(1, 9)), []);
	assert.deepEqual(signalChecks([], unavailable()), []);
});

test('an ongoing dropout points at the latest readings and suppresses the unclear-pulse note', () => {
	const notes = signalChecks(rows(20, { 17: { puls: null }, 18: { puls: null }, 19: { puls: null }, 20: { puls: null } }), unavailable(6));
	assert.deepEqual(notes.map((note) => note.id), ['dropout-puls']);
	assert.equal(notes[0].kind, 'fix');
	assert.equal(notes[0].fromId, 17);
	assert.equal(notes[0].toId, 20);
	assert.match(notes[0].text, /^No pulse signal for the last 4 readings\./);
});

test('a dropout covering the whole window keeps its times but does not link to a moment on the strip', () => {
	const silent = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [index + 1, { ekg: null }]));
	const [note] = signalChecks(rows(12, silent), unavailable());
	assert.equal(note.id, 'dropout-ekg');
	assert.equal(note.fromId, undefined);
	assert.equal(note.from, at(0));
	assert.equal(note.to, at(11));
});

test('reports the longest past dropout and ignores isolated missing values', () => {
	const notes = signalChecks(rows(30, { 3: { emg: null }, 10: { emg: null }, 11: { emg: NaN }, 12: { emg: null }, 20: { ekg: null } }), unavailable());
	assert.deepEqual(notes.map((note) => note.id), ['dropout-emg']);
	assert.equal(notes[0].fromId, 10);
	assert.equal(notes[0].toId, 12);
	assert.match(notes[0].text, /dropped out for 3 readings/);
	assert.deepEqual(signalChecks(rows(30, { 3: { emg: null } }), unavailable()).map((note) => note.id), ['sensors-connected']);
});

test('a clean pulse estimate is kept and its band is clipped to the loaded readings', () => {
	const notes = signalChecks(rows(20), ready(-500, 15));
	assert.deepEqual(notes.map((note) => note.id), ['pulse-ready', 'sensors-connected']);
	assert.equal(notes[0].fromId, 1);
	assert.equal(notes[0].toId, 15);
	assert.match(notes[0].text, /11 clear beats in 9\.8 seconds/);
});

test('unclear beats only get a note once there are five seconds of data', () => {
	assert.deepEqual(signalChecks(rows(20), unavailable(4.9)).map((note) => note.id), ['sensors-connected']);
	assert.deepEqual(signalChecks(rows(20), unavailable(5)).map((note) => note.id), ['pulse-unclear', 'sensors-connected']);
});

test('sorts fixes before suggestions before things to keep, and ignores invalid timestamps', () => {
	const data = [...rows(20, { 18: { ekg: null }, 19: { ekg: null }, 20: { ekg: null } }), { id: 99, created_at: 'invalid', ekg: null, emg: null, puls: null }];
	assert.deepEqual(signalChecks(data, unavailable(6)).map((note) => note.kind), ['fix', 'try']);
});
