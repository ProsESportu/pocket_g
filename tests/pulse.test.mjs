import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatePulse, heartRateAt, pulseConfiguration, pulsePeaks, pulseDisplay } from '../src/lib/pulse.ts';

function waveform(bpm, rate, transform = (value) => value, seconds = 10) {
    return Array.from({ length: Math.ceil(seconds * rate) + 1 }, (_, i) => {
        const t = i / rate;
        return { id: i + 1, puls: transform(500 + 100 * Math.sin(2 * Math.PI * bpm / 60 * t), t, i) };
    });
}

for (const rate of [10, 25, 100, 250, 1000]) {
    for (const bpm of [60, 90, 120]) {
        test(`estimates ${bpm} BPM at ${rate} Hz within 2 BPM`, () => {
            const rows = waveform(bpm, rate);
            const original = structuredClone(rows);
            const result = estimatePulse(rows.reverse(), rate);
            assert.equal(result.status, 'ready', result.reason);
            assert.ok(Math.abs(result.bpm - bpm) <= 2, `${result.bpm} vs ${bpm}`);
            assert.ok(Math.abs(result.hz * 60 - result.bpm) < 1e-12);
            assert.equal(result.duration, 10);
            assert.equal(result.firstRecordId, 1);
            assert.equal(result.lastRecordId, rows.length);
            assert.deepEqual(rows, original.reverse());
        });
    }
}

test('handles drift, moderate deterministic noise, amplitude scale and DC offsets', () => {
    for (const transform of [
        (value, t) => value + 80 * Math.sin(2 * Math.PI * 0.1 * t),
        (value, t) => value + 8 * Math.sin(2 * Math.PI * 13.7 * t),
        (value) => value * 1e100,
        (value) => value - 10000
    ]) {
        const result = estimatePulse(waveform(90, 100, transform), 100);
        assert.equal(result.status, 'ready', result.reason);
        assert.ok(Math.abs(result.bpm - 90) <= 2);
    }
});

test('flat peaks use their midpoint and nearby weaker secondary peaks are suppressed', () => {
    assert.deepEqual(pulsePeaks([0, 1, 4, 4, 4, 1, 0], 1, 1), [3]);
    assert.deepEqual(pulsePeaks([0, 4, 4, 0], 1, 1), [1.5]);
    assert.deepEqual(pulsePeaks([0, 4, 0, 2, 0, 0, 5, 0], 1, 3), [1, 6]);
    assert.deepEqual(pulsePeaks([0, 1, 1, 1], 0.2, 1), []);
    const result = estimatePulse(waveform(60, 100, (_, t) => {
        const phase = t % 1;
        return 500 + 100 * Math.exp(-(((phase - 0.3) / 0.06) ** 2)) + 30 * Math.exp(-(((phase - 0.48) / 0.04) ** 2));
    }), 100);
    assert.equal(result.status, 'ready', result.reason);
    assert.ok(Math.abs(result.bpm - 60) <= 2);
});

test('rejects flat signals, missing latest values, short windows and insufficient beats', () => {
    for (const value of [0, 500]) assert.match(estimatePulse(waveform(60, 100, () => value), 100).reason, /flat/);
    assert.match(estimatePulse(waveform(60, 100, undefined, 4.99), 100).reason, /5 seconds/);
    assert.match(estimatePulse(waveform(10, 100, undefined, 5), 100).reason, /3 clear/);
    for (const value of [null, NaN, Infinity, '123']) {
        const rows = waveform(60, 100);
        rows.at(-1).puls = value;
        assert.equal(estimatePulse(rows, 100).duration, 0);
    }
});

test('uses only the newest segment across missing values and record gaps', () => {
    const rows = waveform(60, 100);
    rows[200].puls = null;
    const result = estimatePulse(rows, 100);
    assert.equal(result.status, 'ready');
    assert.equal(result.firstRecordId, 202);
    assert.equal(result.duration, 7.99);
    rows[750].puls = NaN;
    assert.equal(estimatePulse(rows, 100).duration, 2.49);
    const gaps = waveform(60, 100).filter((row) => row.id !== 752);
    assert.equal(estimatePulse(gaps, 100).duration, 2.48);
    const duplicate = waveform(60, 100);
    duplicate.at(-1).id = duplicate.at(-2).id;
    assert.equal(estimatePulse(duplicate, 100).duration, 0);
});

test('bounds input to the latest ten seconds and supports fractional sampling rates', () => {
    const result = estimatePulse(waveform(90, 100, undefined, 30), 100);
    assert.equal(result.duration, 10);
    assert.equal(result.firstRecordId, 2001);
    const fractional = estimatePulse(waveform(60, 25.5), 25.5);
    assert.equal(fractional.status, 'ready', fractional.reason);
    assert.ok(Math.abs(fractional.bpm - 60) <= 2);
});

test('rejects unsupported BPM and inconsistent intervals', () => {
    for (const bpm of [30, 240]) {
        const boundary = estimatePulse(waveform(bpm, 100), 100);
        assert.equal(boundary.status, 'ready', boundary.reason);
        assert.ok(Math.abs(boundary.bpm - bpm) <= 2);
    }
    assert.match(estimatePulse(waveform(20, 100), 100).reason, /30–240/);
    // Peaks separated by [0.4, 1.6, 0.4, 1.6, ...] seconds.
    const peaks = [0.5, 0.9, 2.5, 2.9, 4.5, 4.9, 6.5, 6.9, 8.5];
    const rows = waveform(60, 100, (_, t) => 500 + peaks.reduce((sum, peak) => sum + 100 * Math.exp(-(((t - peak) / 0.06) ** 2)), 0));
    const result = estimatePulse(rows, 100);
    assert.equal(result.status, 'unavailable');
    assert.match(result.reason, /inconsistent/);
});

test('unset and invalid sampling configuration never produces a frequency', () => {
    assert.equal(pulseConfiguration(null).status, 'unset');
    for (const value of ['', ' ', 'NaN', 'Infinity', '9.9', '1000.1', 'oops']) {
        const result = pulseConfiguration(value);
        assert.equal(result.sampleRate, null);
        assert.equal(result.bpm, null);
        assert.match(result.reason, /10 to 1,000/);
    }
    for (const value of [NaN, Infinity, 0, 1001]) assert.equal(estimatePulse([], value).sampleRate, null);
});

test('refresh failures preserve the last estimate and its original rate; unavailable data clears it', () => {
    const previous = estimatePulse(waveform(60, 100), 100);
    const current = { ...pulseConfiguration('250'), status: 'error', reason: 'Pulse request failed' };
    assert.deepEqual(pulseDisplay(current, previous, ''), { result: previous, stale: true, failure: current.reason });
    assert.equal(pulseDisplay(pulseConfiguration('250'), previous, 'Connection failed').result.sampleRate, 100);
    assert.equal(pulseDisplay(current, null, '').stale, false);
    assert.equal(pulseDisplay(pulseConfiguration('250'), previous, '').result.sampleRate, 250);
    assert.equal(pulseDisplay(pulseConfiguration(null), previous, '').result.status, 'unset');
});

test('beat-to-beat rates skip edge beats, hold to the newest record and gap after missed beats', () => {
    const steady = estimatePulse(waveform(75, 125), 125);
    assert.equal(steady.status, 'ready', steady.reason);
    // 12 beats in 10 s; the two within 0.75 s of an edge and the first kept beat give no rate.
    assert.equal(steady.rates.length, steady.beatCount - 3);
    assert.ok(steady.rates.every((rate) => Math.abs(rate.bpm - 75) <= 0.5));
    assert.ok(steady.rates.slice(1).every((rate, i) => rate.fromId === steady.rates[i].toId + 1));
    assert.equal(heartRateAt(steady, steady.firstRecordId), null);
    assert.ok(Math.abs(heartRateAt(steady, steady.lastRecordId) - 75) <= 2);
    assert.equal(heartRateAt(steady, steady.lastRecordId + 1), null);
    assert.deepEqual(estimatePulse(waveform(10, 100, undefined, 5), 100).rates, []);
    // A missed beat at 4.5 s: 60 BPM holds until the late beat at 5.5 s, then a gap until the next one.
    const peaks = [0.5, 1.5, 2.5, 3.5, 5.5, 6.5, 7.5, 8.5, 9.5];
    const missed = estimatePulse(waveform(60, 100, (_, t) => 500 + peaks.reduce((sum, peak) => sum + 100 * Math.exp(-(((t - peak) / 0.06) ** 2)), 0)), 100);
    assert.equal(missed.status, 'ready', missed.reason);
    assert.ok(Math.abs(heartRateAt(missed, 501) - 60) <= 0.5);
    assert.equal(heartRateAt(missed, 601), null);
    assert.ok(Math.abs(heartRateAt(missed, 701) - 60) <= 0.5);
});
