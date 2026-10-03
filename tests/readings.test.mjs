import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRecentReadings } from '../src/lib/readings.ts';

const origin = Date.UTC(2026, 9, 3, 19, 36, 0);
const rows = (count, spacing = 8) => Array.from({ length: count }, (_, i) => ({ id: i + 1, created_at: new Date(origin + i * spacing).toISOString(), ekg: 500, emg: 400, puls: 600 }));
function databaseMock(readings, cap = 1000) {
	const calls = [];
	const fetcher = async (input, options) => {
		const url = new URL(input);
		calls.push({ url, signal: options.signal });
		assert.equal(options.headers.apikey, 'test-key');
		assert.equal(url.searchParams.get('select'), 'id,created_at,ekg,emg,puls');
		assert.equal(url.searchParams.get('order'), 'id.desc');
		const before = url.searchParams.get('id');
		const page = readings.filter((row) => before === null || row.id < Number(before.split('.')[1]))
			.sort((a, b) => b.id - a.id).slice(0, Math.min(cap, Number(url.searchParams.get('limit'))));
		return Response.json(page);
	};
	return { fetcher, calls };
}
const load = (fetcher, seconds = 12.5) => loadRecentReadings(fetcher, 'https://example.supabase.co', 'test-key', seconds);

test('pages back from the newest row until the window is covered, sizing the last page from the spacing', async () => {
	const { fetcher, calls } = databaseMock(rows(5000));
	const result = await load(fetcher);
	assert.equal(result[0].id, 5000);
	// 12.5 s at 8 ms spacing needs 1,563 intervals (1,564 rows); the second page asks only for what the first page's spacing predicts.
	assert.equal(result.length, 1564);
	assert.equal(calls.length, 2);
	assert.equal(calls[0].url.searchParams.has('id'), false);
	assert.equal(calls[1].url.searchParams.get('id'), 'lt.4001');
	assert.equal(calls[0].signal, calls[1].signal);
	assert.ok(Date.parse(result[0].created_at) - Date.parse(result.at(-1).created_at) >= 12500);
});

test('continues across API caps below 1,000 rows and stops when rows run out', async () => {
	const capped = databaseMock(rows(5000), 200);
	assert.equal((await load(capped.fetcher)).length, 1564);
	assert.ok(capped.calls.length > 7);
	const short = databaseMock(rows(300));
	assert.equal((await load(short.fetcher)).length, 300);
	assert.equal(short.calls.length, 2);
});

test('stops at the row cap or at timestamps it cannot measure', async () => {
	// 0.1 ms spacing would need 125,001 rows; the cap is 1,000 Hz for the window.
	const dense = databaseMock(rows(20000, 0.1));
	assert.equal((await load(dense.fetcher)).length, 12501);
	const invalid = databaseMock(rows(5000).map((row) => ({ ...row, created_at: 'not a time' })));
	assert.equal((await load(invalid.fetcher)).length, 1000);
	assert.equal(invalid.calls.length, 1);
});

test('rejects failed requests, oversized pages and out-of-order rows', async () => {
	await assert.rejects(load(async () => new Response('', { status: 401 })), /HTTP 401/);
	await assert.rejects(load(async () => Response.json(rows(1001))), /invalid page/);
	await assert.rejects(load(async () => Response.json(rows(3))), /out of order/);
});
