import { test } from 'node:test';
import assert from 'node:assert/strict';
import { databaseEcgWindow } from '../src/lib/ecg-database.ts';
import { databaseEmgWindow } from '../src/lib/emg-readings.ts';
import { loadRecentReadings } from '../src/lib/readings.ts';
import { captureMilliseconds } from '../src/lib/capture-time.ts';

const stamp = (microseconds) => new Date(Math.floor(microseconds / 1000)).toISOString()
    .replace(/\d{3}Z$/, `${String(microseconds % 1000000).padStart(6, '0')}Z`);
const rows = (count = 20000, spacing = 500) => Array.from({ length: count }, (_, i) => ({
    id: i + 1, created_at: stamp(i * spacing), ekg: Math.sin(i), emg: Math.sin(i), puls: Math.sin(i)
}));

test('ECG and EMG accept microsecond timestamps at 2 kHz', () => {
    const data = rows();
    assert.equal(databaseEcgWindow(data).samples.length, 20000);
    assert.equal(databaseEmgWindow(data).reason, '');
});

test('historical 125 Hz and incorrect average rates cannot enter either model', () => {
    for (const spacing of [8000, 1000, 250]) {
        const data = rows(20000, spacing);
        const ecg = databaseEcgWindow(data), emg = databaseEmgWindow(data);
        assert.equal(ecg.samples.length, 0);
        assert.match(ecg.reason, /uneven timing/);
        assert.ok(emg.reason);
    }
});

test('ECG rejects invalid/repeated/backward capture times, missing IDs and pauses', () => {
    for (const change of [
        (data) => { data[10000].created_at = 'invalid'; },
        (data) => { data[10000].created_at = data[9999].created_at; },
        (data) => { data[10000].created_at = data[9998].created_at; },
        (data) => { data[10000].id += .5; },
        (data) => { data[10000].created_at = stamp(10000 * 500 + 100000); }
    ]) {
        const data = rows(); change(data);
        assert.equal(databaseEcgWindow(data).samples.length, 0);
        assert.ok(databaseEmgWindow(data).reason);
    }
});

test('rate transitions exclude earlier 125 Hz data until a full new window exists', () => {
    const data = rows(21000);
    for (let i = 0; i < 11000; i++) data[i].created_at = stamp(i * 8000);
    for (let i = 11000; i < data.length; i++) data[i].created_at = stamp(11000 * 8000 + (i - 11000) * 500);
    assert.ok(databaseEcgWindow(data).reason);
    const emg = databaseEmgWindow(data);
    assert.equal(emg.sampleCount, 10000);
    assert.equal(emg.firstRecordId, 11001);
    assert.ok(emg.reason);
});

test('dashboard pagination covers the full 12.5 seconds at 2 kHz', async () => {
    const data = rows(30000).reverse();
    let calls = 0;
    const result = await loadRecentReadings(async (input) => {
        calls++;
        const url = new URL(input), before = url.searchParams.get('id');
        const cutoff = before ? Number(before.split('.')[1]) : Infinity;
        return Response.json(data.filter((row) => row.id < cutoff).slice(0, Number(url.searchParams.get('limit'))));
    }, 'https://example.supabase.co', 'test-key', 12.5);
    assert.equal(result.length, 25001);
    assert.equal(calls, 26);
    assert.equal(captureMilliseconds(result[0].created_at) - captureMilliseconds(result.at(-1).created_at), 12500);
});
