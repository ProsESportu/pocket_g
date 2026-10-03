import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePulseWithTiming, pulseConfiguration } from '../src/lib/pulse.ts';

const origin = 1700000000000;
function rows(bpm = 90, rate = 100, irregular = false) {
    let t = 0;
    return Array.from({ length: rate * 10 + 1 }, (_, i) => {
        if (i) t += irregular ? (1 + 0.35 * Math.sin(i * 1.713)) / rate : 1 / rate;
        return { id: i + 1, created_at: new Date(origin + Math.round(t * 1000)).toISOString(), puls: 500 + 100 * Math.sin(2 * Math.PI * bpm / 60 * t) };
    });
}
const estimate = (readings, rate = null) => estimatePulseWithTiming(readings, pulseConfiguration(rate));

for (const bpm of [60, 90, 120]) {
    for (const irregular of [false, true]) {
        test(`timestamp estimate ${bpm} BPM, irregular=${irregular}`, () => {
            const result = estimate(rows(bpm, 100, irregular));
            assert.equal(result.status, 'ready', result.reason);
            assert.equal(result.timing, 'timestamps');
            assert.equal(result.timestampsInvalid, false);
            assert.equal(result.sampleRate, null);
            assert.ok(Math.abs(result.bpm - bpm) <= 2, String(result.bpm));
            assert.ok(result.duration <= 10);
        });
    }
}

test('valid timestamps take priority over stale or invalid rate query parameters', () => {
    for (const rate of ['250', 'nonsense', '1']) {
        const result = estimate(rows(), rate);
        assert.equal(result.timing, 'timestamps');
        assert.equal(result.status, 'ready');
        assert.ok(Math.abs(result.bpm - 90) < 2);
    }
});

test('repeated, backwards, missing and malformed timestamps require the fallback picker', () => {
    for (const value of [undefined, 'invalid', rows().at(-1).created_at, new Date(origin + 20000).toISOString()]) {
        const samples = rows();
        samples.at(-2).created_at = value;
        const unconfigured = estimate(samples);
        assert.equal(unconfigured.timestampsInvalid, true);
        assert.equal(unconfigured.status, 'unset');
        assert.equal(unconfigured.bpm, null);
        const fallback = estimate(samples, '100');
        assert.equal(fallback.timing, 'sample-rate');
        assert.equal(fallback.status, 'ready');
        assert.ok(Math.abs(fallback.bpm - 90) < 2);
    }
});

test('short and flat signals with valid timestamps do not trigger a rate picker', () => {
    for (const samples of [[], rows().slice(-100), rows().map((r) => ({ ...r, puls: 500 }))]) {
        const result = estimate(samples);
        assert.equal(result.timestampsInvalid, false);
        assert.equal(result.timing, 'timestamps');
        assert.equal(result.status, 'unavailable');
    }
});

test('splits at missing samples, record gaps and long capture pauses', () => {
    const samples = rows();
    samples[600].puls = null;
    assert.ok(estimate(samples).duration < 5);
    assert.ok(estimate(rows().filter((r) => r.id !== 602)).duration < 5);
    const paused = rows().map((r, i) => ({ ...r, created_at: new Date(Date.parse(r.created_at) + (i > 600 ? 3000 : 0)).toISOString() }));
    const result = estimate(paused);
    assert.equal(result.timestampsInvalid, false);
    assert.ok(result.duration < 5);
    assert.equal(result.firstRecordId, 602);
});

test('preserves Postgres sub-millisecond timestamps instead of marking them duplicates', () => {
    const samples = rows(60, 1000).map((r, i) => ({ ...r, created_at: `2023-11-14T22:13:${String(20 + Math.floor(i / 1001)).padStart(2, '0')}.${String(Math.round((i % 1001) * 1000000 / 1001)).padStart(6, '0')}Z` }));
    const result = estimate(samples);
    assert.equal(result.timestampsInvalid, false);
    assert.equal(result.status, 'ready', result.reason);
    assert.ok(Math.abs(result.bpm - 60) < 2);
});

test('a longer window covers more beats and starts the beat-to-beat rates earlier', () => {
    const long = Array.from({ length: 1501 }, (_, i) => ({ id: i + 1, created_at: new Date(origin + i * 10).toISOString(), puls: 500 + 100 * Math.sin(2 * Math.PI * 75 / 60 * i / 100) }));
    const standard = estimate(long);
    const extended = estimatePulseWithTiming(long, pulseConfiguration(null), 12.5);
    assert.equal(standard.duration, 10);
    assert.equal(extended.duration, 12.5);
    assert.ok(extended.beatCount > standard.beatCount);
    assert.ok(extended.rates[0].fromId < standard.rates[0].fromId);
    assert.equal(extended.rates.at(-1).toId, standard.rates.at(-1).toId);
});
