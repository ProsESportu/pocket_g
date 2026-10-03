import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseEcgWindow } from '../src/lib/ecg-database.ts';
import { loadDatabaseEcg } from '../src/lib/ecg-readings.ts';

const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: i + 1, created_at: new Date(i * 2).toISOString(), ekg: Math.sin(i / 100) }));

test('selects exactly the latest 5,000 ECG values, oldest to newest, without mutation', () => {
    const readings = rows(6000).reverse();
    const original = readings.map((row) => row.id);
    const window = databaseEcgWindow(readings);
    assert.equal(window.samples.length, 5000);
    assert.equal(window.firstRecordId, 1001);
    assert.equal(window.lastRecordId, 6000);
    assert.equal(window.samples[0], Math.sin(1000 / 100));
    assert.deepEqual(readings.map((row) => row.id), original);
});

test('insufficient or invalid ECG values never produce padded or stitched model inputs', () => {
    for (const count of [0, 100, 4999]) {
        const window = databaseEcgWindow(rows(count));
        assert.equal(window.available, count);
        assert.deepEqual(window.samples, []);
    }
    for (const value of [null, NaN, Infinity, '123', 1e100]) {
        const readings = rows(5010);
        readings[5000].ekg = value;
        const window = databaseEcgWindow(readings);
        assert.equal(window.available, 4999);
        assert.equal(window.rowCount, 5000);
        assert.deepEqual(window.samples, []);
    }
});

function databaseMock(readings, cap = 1000) {
    const urls = [];
    const fetcher = async (input, options) => {
        const url = new URL(input);
        urls.push(url);
        assert.equal(options.headers.apikey, 'test-publishable-key');
        assert.equal(url.searchParams.get('select'), 'id,created_at,ekg');
        assert.equal(url.searchParams.get('order'), 'id.desc');
        assert.equal(url.searchParams.has('ekg'), false, 'missing newest samples must remain visible');
        const [operator, cutoff] = url.searchParams.get('id').split('.');
        const page = readings.filter((row) => operator === 'lte' ? row.id <= Number(cutoff) : row.id < Number(cutoff))
            .sort((a, b) => b.id - a.id).slice(0, Math.min(cap, Number(url.searchParams.get('limit'))));
        return Response.json(page);
    };
    return { fetcher, urls };
}

test('pages past Supabase row limits and keeps the initial snapshot boundary', async () => {
    const { fetcher, urls } = databaseMock(rows(6100), 600);
    const window = await loadDatabaseEcg(fetcher, 'https://example.supabase.co', 'test-publishable-key', 6000);
    assert.equal(window.error, '');
    assert.equal(window.samples.length, 5000);
    assert.equal(window.firstRecordId, 1001);
    assert.equal(window.lastRecordId, 6000);
    assert.equal(urls.length, 9);
    assert.equal(urls[0].searchParams.get('id'), 'lte.6000');
    assert.equal(urls[1].searchParams.get('id'), 'lt.5401');
});

test('counts all available values when the database has fewer than 5,000', async () => {
    const { fetcher } = databaseMock(rows(789), 200);
    const window = await loadDatabaseEcg(fetcher, 'https://example.supabase.co', 'test-publishable-key', 789);
    assert.equal(window.available, 789);
    assert.deepEqual(window.samples, []);
    const empty = await loadDatabaseEcg(() => { throw new Error('Should not fetch'); }, '', '', undefined);
    assert.equal(empty.available, 0);
});

test('never falls back to an old ECG recording when the newest rows have no ECG value', async () => {
    const readings = rows(12000);
    for (const row of readings.slice(6000)) row.ekg = null;
    const { fetcher } = databaseMock(readings);
    const window = await loadDatabaseEcg(fetcher, 'https://example.supabase.co', 'test-publishable-key', 12000);
    assert.deepEqual(window.samples, []);
    assert.equal(window.available, 0);
    assert.equal(window.rowCount, 5000);
    assert.equal(window.firstRecordId, 7001);
    assert.equal(window.lastRecordId, 12000);
});

test('a missing value in the newest ECG window is not replaced with an older sample', async () => {
    const readings = rows(6000);
    readings[5500].ekg = null;
    const { fetcher } = databaseMock(readings, 600);
    const window = await loadDatabaseEcg(fetcher, 'https://example.supabase.co', 'test-publishable-key', 6000);
    assert.equal(window.available, 4999);
    assert.equal(window.firstRecordId, 1001);
    assert.equal(window.lastRecordId, 6000);
    assert.deepEqual(window.samples, []);
});

test('failed database fetches discard partial inputs and distinguish errors from insufficient data', async () => {
    const { fetcher } = databaseMock(rows(6000));
    let calls = 0;
    const window = await loadDatabaseEcg((...args) => ++calls === 2 ? Promise.resolve(new Response('', { status: 503 })) : fetcher(...args), 'https://example.supabase.co', 'test-publishable-key', 6000);
    assert.match(window.error, /HTTP 503/);
    assert.deepEqual(window.samples, []);
    const repeated = await loadDatabaseEcg(() => Promise.resolve(Response.json(rows(2).reverse())), 'https://example.supabase.co', '', 2);
    assert.match(repeated.error, /invalid ECG sample order/);
});
