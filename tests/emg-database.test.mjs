import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseEmgWindow, loadDatabaseEmg } from '../src/lib/emg-readings.ts';

const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: i + 1, created_at: new Date(Math.floor(i / 2)).toISOString().replace(/\d{3}Z$/, `${String((i % 2000) * 500).padStart(6, '0')}Z`), emg: Math.sin(i) }));
function mock(readings, cap = 1000) {
    const urls = [];
    const fetcher = async (input, options) => {
        const url = new URL(input);
        urls.push(url);
        assert.equal(options.headers.apikey, 'public-key');
        assert.equal(url.searchParams.get('select'), 'id,created_at,emg');
        assert.equal(url.searchParams.has('emg'), false, 'null samples must remain visible');
        const [operator, cutoff] = url.searchParams.get('id').split('.');
        return Response.json(readings.filter((row) => operator === 'lte' ? row.id <= +cutoff : row.id < +cutoff)
            .sort((a, b) => b.id - a.id).slice(0, Math.min(cap, +url.searchParams.get('limit'))));
    };
    return { fetcher, urls };
}

test('EMG pages through reduced API caps and fixes the snapshot despite newer inserts', async () => {
    const input = rows(130100);
    const { fetcher, urls } = mock(input, 600);
    const window = await loadDatabaseEmg(fetcher, 'https://example.supabase.co', 'public-key', 130000);
    assert.equal(window.samples.length, 120000);
    assert.equal(window.firstRecordId, 10001);
    assert.equal(window.lastRecordId, 130000);
    assert.equal(window.duration, 60);
    assert.equal(window.reason, '');
    assert.equal(window.samples[0], Math.sin(10000));
    assert.equal(urls[0].searchParams.get('id'), 'lte.130000');
    assert.equal(urls.at(-1).searchParams.get('limit'), '600');
    assert.equal(urls.length, 200);
});

test('EMG stops at null/nonfinite values and never skips a missing newest sample', () => {
    for (const bad of [null, NaN, Infinity, '123']) {
        const input = rows(3000).reverse();
        input[1500].emg = bad;
        assert.equal(databaseEmgWindow(input).sampleCount, 1500);
        input[0].emg = bad;
        assert.equal(databaseEmgWindow(input).sampleCount, 0);
    }
});

test('EMG selects the newest window regardless of input order without mutating readings', () => {
    const input = rows(130000);
    const original = input.map((row) => row.id);
    for (const readings of [input, [...input].reverse()]) {
        const window = databaseEmgWindow(readings);
        assert.equal(window.firstRecordId, 10001);
        assert.equal(window.lastRecordId, 130000);
        assert.equal(window.samples.length, 120000);
        assert.equal(window.samples.at(-1), input.at(-1).emg);
    }
    assert.deepEqual(input.map((row) => row.id), original);
});

test('EMG detects missing IDs, pauses and breaks crossing page boundaries', async () => {
    const input = rows(5000);
    input[2999].emg = null;
    const { fetcher, urls } = mock(input, 1000);
    const window = await loadDatabaseEmg(fetcher, 'https://example.supabase.co', 'public-key', 5000);
    assert.equal(window.sampleCount, 2000);
    assert.equal(window.firstRecordId, 3001);
    assert.equal(urls.length, 3);
    const gap = rows(3000).reverse();
    gap.splice(1500, 1);
    assert.equal(databaseEmgWindow(gap).sampleCount, 1500);
    const paused = rows(3000).reverse();
    paused[1500].created_at = new Date(Date.parse(paused[1499].created_at) - 1001).toISOString();
    assert.equal(databaseEmgWindow(paused).sampleCount, 1500);
});

test('EMG permits 10 seconds and reports shorter/empty recordings without padding', async () => {
    assert.equal(databaseEmgWindow(rows(20000).reverse()).reason, '');
    const short = databaseEmgWindow(rows(19999).reverse());
    assert.match(short.reason, /10 continuous seconds/);
    assert.equal(short.samples.length, 19999);
    const empty = await loadDatabaseEmg(() => { throw new Error('Unexpected fetch'); }, '', '', undefined);
    assert.equal(empty.sampleCount, 0);
});

test('EMG rejects malformed pages, repeated IDs, escaping the snapshot, HTTP errors and cancellation', async () => {
    for (const page of [null, {}, [{ id: 5 }, { id: 5 }], [{ id: 6 }], [{ id: 4 }, { id: 5 }]]) {
        await assert.rejects(loadDatabaseEmg(async () => Response.json(page), 'https://example.supabase.co', 'public-key', 5), /invalid EMG/);
    }
    await assert.rejects(loadDatabaseEmg(async () => new Response('', { status: 403 }), 'https://example.supabase.co', 'public-key', 5), /HTTP 403/);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(loadDatabaseEmg(() => { throw new Error('Should not fetch'); }, 'https://example.supabase.co', 'public-key', 5, abort.signal), { name: 'AbortError' });
});
