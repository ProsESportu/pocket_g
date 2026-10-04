import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pulseConfiguration } from '../src/lib/pulse.ts';
import { loadDatabasePulse } from '../src/lib/pulse-readings.ts';

const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: i + 1, puls: 500 + 100 * Math.sin(2 * Math.PI * i / 100) }));
function databaseMock(readings, cap = 1000) {
    const calls = [];
    const fetcher = async (input, options) => {
        const url = new URL(input);
        calls.push({ url, signal: options.signal });
        assert.equal(options.headers.apikey, 'test-key');
        assert.equal(url.searchParams.get('select'), 'id,created_at,puls');
        assert.equal(url.searchParams.get('order'), 'id.desc');
        assert.equal(url.searchParams.has('puls'), false);
        const [operator, cutoff] = url.searchParams.get('id').split('.');
        const page = readings.filter((row) => operator === 'lte' ? row.id <= Number(cutoff) : row.id < Number(cutoff))
            .sort((a, b) => b.id - a.id).slice(0, Math.min(cap, Number(url.searchParams.get('limit'))));
        return Response.json(page);
    };
    return { fetcher, calls };
}
const load = (fetcher, throughId, rate = '100') => loadDatabasePulse(fetcher, 'https://example.supabase.co', 'test-key', throughId, pulseConfiguration(rate));

test('pages across API caps, uses a fixed snapshot and shared timeout signal', async () => {
    const { fetcher, calls } = databaseMock(rows(1300), 200);
    const result = await load(fetcher, 1200);
    assert.equal(result.status, 'ready', result.reason);
    assert.equal(result.firstRecordId, 200);
    assert.equal(result.lastRecordId, 1200);
    assert.equal(calls.length, 6);
    assert.equal(calls[0].url.searchParams.get('id'), 'lte.1200');
    assert.equal(calls[1].url.searchParams.get('id'), 'lt.1001');
    assert.equal(calls.at(-1).url.searchParams.get('limit'), '1');
    assert.ok(calls.every((call) => call.signal === calls[0].signal));
});

test('always checks timestamps even with unset/invalid rates; empty dashboards do not fetch', async () => {
    const forbidden = () => { throw new Error('Unexpected fetch'); };
    for (const rate of [null, '', 'oops', '9', '4001']) {
        const { fetcher, calls } = databaseMock(rows(1200));
        const result = await load(fetcher, 1200, rate);
        assert.equal(result.sampleRate, null);
        assert.notEqual(result.status, 'error');
        assert.equal(result.timestampsInvalid, true);
        assert.equal(calls.length, 1);
    }
    assert.equal((await load(forbidden, undefined)).duration, 0);
});

test('uses timestamp timing by default and ignores an old configured rate', async () => {
    const timestampRows = rows(1300).map((row) => ({ ...row, created_at: new Date(1700000000000 + (row.id - 1) * 10).toISOString() }));
    for (const rate of [null, '250', 'oops']) {
        const { fetcher, calls } = databaseMock(timestampRows, 200);
        const result = await load(fetcher, 1200, rate);
        assert.equal(result.status, 'ready', result.reason);
        assert.ok(Math.abs(result.bpm - 60) < 2);
        assert.equal(result.timing, 'timestamps');
        assert.equal(result.timestampsInvalid, false);
        assert.equal(result.sampleRate, null);
        assert.equal(result.firstRecordId, 200);
        assert.equal(result.lastRecordId, 1200);
        assert.equal(calls.length, 6);
    }
});

test('keeps null samples as continuity breaks and reports insufficient/empty data', async () => {
    const readings = rows(1300);
    readings[1000].puls = null;
    const { fetcher } = databaseMock(readings, 200);
    const result = await load(fetcher, 1300);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.firstRecordId, 1002);
    assert.equal(result.duration, 2.98);
    assert.equal((await load(databaseMock([]).fetcher, 1)).duration, 0);
    assert.match((await load(databaseMock(rows(400)).fetcher, 400)).reason, /5 seconds/);
});

test('pulse estimates the newest recording rather than an older recording with a different rate', async () => {
    const readings = rows(4000).map((row) => ({
        ...row,
        created_at: new Date(1700000000000 + (row.id - 1) * 10).toISOString(),
        puls: 500 + 100 * Math.sin(2 * Math.PI * (row.id - 1) / (row.id > 2000 ? 50 : 100))
    }));
    const { fetcher } = databaseMock(readings, 200);
    const result = await load(fetcher, 4000);
    assert.equal(result.status, 'ready', result.reason);
    assert.equal(result.firstRecordId, 3000);
    assert.equal(result.lastRecordId, 4000);
    assert.ok(Math.abs(result.bpm - 120) < 2);

    readings.at(-1).puls = null;
    const missing = await load(databaseMock(readings).fetcher, 4000);
    assert.equal(missing.status, 'unavailable');
    assert.equal(missing.lastRecordId, null);
    assert.equal(missing.bpm, null);
});

test('API/network/timeouts discard partial samples and stay pulse-specific', async () => {
    const { fetcher } = databaseMock(rows(1300), 200);
    let count = 0;
    const failed = await load((...args) => ++count === 2 ? new Response('', { status: 503 }) : fetcher(...args), 1300);
    assert.equal(failed.status, 'error');
    assert.match(failed.reason, /pulse samples.*503/);
    assert.equal(failed.firstRecordId, null);
    assert.equal(failed.duration, 0);
    for (const error of [new Error('Network failed'), new DOMException('Timed out', 'TimeoutError'), new DOMException('Aborted', 'AbortError')]) {
        assert.equal((await load(() => { throw error; }, 1300)).status, 'error');
    }
});

test('rejects out-of-order, duplicate, out-of-boundary and malformed pages', async () => {
    for (const page of [[{ id: 1301, puls: 1 }], [{ id: 2, puls: 1 }, { id: 3, puls: 1 }], [{ id: 2, puls: 1 }, { id: 2, puls: 1 }], [{ id: 1.1, puls: 1 }], [null], {}]) {
        const result = await load(() => Response.json(page), 1300);
        assert.equal(result.status, 'error');
        assert.match(result.reason, /invalid pulse/);
    }
});
