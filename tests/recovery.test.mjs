import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecoveryPulse, measureRecovery, recoveryCoachNotes, RECOVERY_TOTAL_SECONDS } from '../src/lib/recovery.ts';

const START = Date.UTC(2026, 9, 4, 12);
// Heart rate falls linearly from `from` to `to` BPM over a minute; 125 Hz pulse waveform with a matching phase.
function recoveryPulse({ from = 140, to = 110, seconds = 70, rate = 125, startId = 1, flatAfter = Infinity } = {}) {
	let phase = 0;
	return Array.from({ length: Math.round(seconds * rate) }, (_, i) => {
		const t = i / rate, bpm = from + (to - from) * Math.min(t, 60) / 60;
		phase += bpm / 60 / rate;
		return { id: startId + i, created_at: new Date(START + t * 1000).toISOString(), puls: t >= flatAfter ? 512 : Math.round(500 + 120 * Math.sin(2 * Math.PI * phase)) };
	});
}

test('measures the drop from the first 10 s to one minute later', () => {
	const result = measureRecovery(recoveryPulse(), START, 'set 2');
	assert.equal(result.status, 'done', result.reason);
	assert.ok(Math.abs(result.startBpm - 137.5) < 3, `start ${result.startBpm}`);
	assert.ok(Math.abs(result.endBpm - 110) < 3, `end ${result.endBpm}`);
	assert.ok(Math.abs(result.dropBpm - 27.5) < 4, `drop ${result.dropBpm}`);
	assert.deepEqual(result.curve.map((point) => point.seconds), [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
	assert.ok(result.curve.every((point, i) => i === 0 || point.bpm <= result.curve[i - 1].bpm + 1));
});

test('times a 1,800 Hz board by its sampling rate when upload batches overlap', () => {
	// Batches of 500 stamped 0.5 ms apart from their real start, with two neighbouring batches interleaved.
	const rows = recoveryPulse({ rate: 1800 }).map((row, i) => ({ ...row, created_at: new Date(START + Math.floor(i / 500) * 500 / 1.8 + (i % 500) * 0.5).toISOString() }));
	for (let i = 30000; i < 30016; i += 2) [rows[i].created_at, rows[i + 500].created_at] = [rows[i + 500].created_at, rows[i].created_at];
	assert.equal(measureRecovery(rows, START, 'set 2').status, 'unavailable');
	const cache = {};
	const result = measureRecovery(rows, START, 'set 2', 1800, cache);
	assert.equal(result.status, 'done', result.reason);
	assert.ok(Math.abs(result.startBpm - 137.5) < 3 && Math.abs(result.endBpm - 110) < 3, `${result.startBpm} → ${result.endBpm}`);
	// Finished windows are kept, so a live recovery analyses each one once.
	assert.ok(Object.keys(cache).length >= 11);
	assert.deepEqual(measureRecovery(rows, START, 'set 2', 1800, cache), result);
});

test('reports recording progress before a minute has passed', () => {
	const result = measureRecovery(recoveryPulse({ seconds: 30 }), START, 'set 1');
	assert.equal(result.status, 'recording');
	assert.ok(result.elapsedSeconds > 29 && result.elapsedSeconds < 30);
	assert.ok(result.startBpm > 130);
	assert.equal(result.curve.length, 4);
	assert.equal(measureRecovery([], START, 'set 1').status, 'recording');
});

test('an unclear pulse gives a reason instead of a number, and a coach note to fix it', () => {
	const result = measureRecovery(recoveryPulse({ flatAfter: 50 }), START, 'set 3');
	assert.equal(result.status, 'unavailable');
	assert.match(result.reason, /^Pulse beats weren’t clear one minute after set 3\./);
	assert.equal(result.dropBpm, null);
	const [note] = recoveryCoachNotes([result]);
	assert.equal(note.kind, 'try');
});

test('coach note states the measured drop without judging it', () => {
	const [note] = recoveryCoachNotes([measureRecovery(recoveryPulse(), START, 'set 2')]);
	assert.equal(note.kind, 'keep');
	assert.match(note.text, /^Heart rate dropped (2[5-9]|30) BPM in the first minute after set 2\.$/);
	assert.equal(note.fromId, undefined);
	assert.deepEqual(recoveryCoachNotes([]), []);
});

test('loads pulse rows from the start time, then only newer rows, across pages', async () => {
	const rows = recoveryPulse({ seconds: RECOVERY_TOTAL_SECONDS + 5 });
	const calls = [];
	const fetcher = async (input) => {
		const url = new URL(input);
		calls.push(url);
		assert.equal(url.searchParams.get('select'), 'id,created_at,puls');
		assert.equal(url.searchParams.get('order'), 'id.asc');
		const since = Date.parse(url.searchParams.get('created_at').slice(4));
		const after = url.searchParams.has('id') ? Number(url.searchParams.get('id').slice(3)) : -Infinity;
		return Response.json(rows.filter((row) => Date.parse(row.created_at) >= since && row.id > after).slice(0, 1000));
	};
	const first = await loadRecoveryPulse(fetcher, 'https://example.supabase.co', 'key', START + 1000, null);
	assert.equal(first[0].id, 126);
	assert.ok(first.length > 8000 && Date.parse(first.at(-1).created_at) - START > RECOVERY_TOTAL_SECONDS * 1000);
	const later = await loadRecoveryPulse(fetcher, 'https://example.supabase.co', 'key', START + 1000, first.at(-1).id);
	assert.deepEqual(later, rows.filter((row) => row.id > first.at(-1).id));
	await assert.rejects(loadRecoveryPulse(async () => new Response('', { status: 500 }), 'https://example.supabase.co', 'key', START, null), /HTTP 500/);
});
