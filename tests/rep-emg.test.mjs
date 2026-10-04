import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReps } from '../src/lib/reps.ts';
import { loadSetEmg, muscleByRep, muscleCoachNotes, setEmgWindow } from '../src/lib/rep-emg.ts';
import { curlRows, curls, ORIGIN } from './imu-fixture.mjs';

const [set] = analyzeReps(curlRows({ reps: curls(8, { range: 130, up: 1, down: 1.5 }) }));
// 125 Hz EMG on the pulse board's clock, `behind` seconds behind the motion clock; strong during `active` reps.
function emgRows({ behind = 0, active = [1, 2, 3, 4, 5], from = ORIGIN - 2000, to = ORIGIN + 30000, gap = null } = {}) {
	let seed = 7;
	const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
	const rows = [];
	for (let ms = from, id = 1; ms <= to; ms += 8, id++) {
		const rep = set.reps.find((item) => ms >= item.startMs && ms <= item.endMs);
		const amplitude = rep && active.includes(rep.rep) ? 300 : 20;
		if (gap && ms >= gap[0] && ms <= gap[1]) continue;
		rows.push({ id, created_at: new Date(ms - behind * 1000).toISOString(), emg: Math.round(512 + amplitude * noise()) });
	}
	return rows;
}

test('reps without muscle activity fall below half of reps 1–3', () => {
	const muscle = muscleByRep(set, emgRows(), 0);
	assert.equal(muscle.covered, 8);
	assert.deepEqual(muscle.reps.map((rep) => rep.low), [false, false, false, false, false, true, true, true]);
	assert.ok(muscle.reps.slice(0, 5).every((rep) => rep.percent > 80 && rep.percent < 120));
	assert.ok(muscle.trace.length > 100);
	const [note] = muscleCoachNotes(muscle, [set]);
	assert.match(note.text, /^Set 1: reps 6–8 moved with about \d+% of the muscle activity of reps 1–3\.$/);
});

test('the clock offset lines up EMG from a board whose clock runs behind', () => {
	const rows = emgRows({ behind: 2 });
	assert.deepEqual(muscleByRep(set, rows, 2).reps.map((rep) => rep.low), [false, false, false, false, false, true, true, true]);
	const window = setEmgWindow(set, 2);
	assert.ok(window.from < set.reps[0].startMs - 2000 && window.to > set.reps.at(-1).endMs - 2000);
});

test('missing EMG shows as uncovered reps and a coverage note', () => {
	const muscle = muscleByRep(set, emgRows({ gap: [set.reps[6].startMs - 100, set.reps[7].endMs + 100] }), 0);
	assert.equal(muscle.covered, 6);
	assert.equal(muscle.reps[7].activity, null);
	assert.ok(muscleCoachNotes(muscle, [set]).some((note) => /EMG was found for 6 of 8 reps in set 1/.test(note.text)));
	const none = muscleByRep(set, [], 0);
	assert.equal(none.covered, 0);
	assert.deepEqual(muscleCoachNotes(none, [set]), []);
});

test('loads EMG for a time range in ID order across pages', async () => {
	const rows = emgRows();
	const fetcher = async (input) => {
		const url = new URL(input);
		assert.equal(url.searchParams.get('select'), 'id,created_at,emg');
		const [, from, to, after] = url.searchParams.get('and').match(/^\(created_at\.gte\.(.+?),created_at\.lte\.(.+?),id\.gt\.(\d+)\)$/);
		return Response.json(rows.filter((row) => row.created_at >= from && row.created_at <= to && row.id > +after).slice(0, 1000));
	};
	const { from, to } = setEmgWindow(set, 0);
	const loaded = await loadSetEmg(fetcher, 'https://example.supabase.co', 'key', from, to);
	assert.deepEqual(loaded, rows.filter((row) => Date.parse(row.created_at) >= from && Date.parse(row.created_at) <= to));
	assert.ok(loaded.length > 1000);
});
