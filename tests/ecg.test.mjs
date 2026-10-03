import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ECG_SAMPLE_RATE, ECG_BASELINE_SAMPLES, parseLabels, validateWaveform, scoreLogits } from '../src/lib/ecg.ts';
import { prepareWaveform } from '../src/lib/ecg-preprocessing.ts';

const labels = parseLabels(readFileSync(new URL('../static/models/ecgfounder/tasks.txt', import.meta.url), 'utf8'));
const reference = JSON.parse(readFileSync(new URL('./fixtures/ecg-preprocessing.json', import.meta.url), 'utf8'));
const signal = reference.cases[0].samples;

test('accepts a complete database ECG window without altering samples', () => {
    assert.deepEqual(Array.from(validateWaveform(signal)), signal);
});

test('rejects missing, nonfinite, flat or multichannel database waveforms', () => {
    const bad = [[], signal.slice(1), [...signal, 1], Array(5000).fill(1), signal.map((x, i) => i === 50 ? null : x), signal.map((x, i) => i === 50 ? '2' : x), signal.map((x, i) => i === 50 ? Infinity : x), [signal]];
    for (const value of bad) assert.throws(() => validateWaveform(value));
});

for (const fixture of reference.cases) {
    test(`raw preprocessing agrees with SciPy for ${fixture.name}, including edges`, () => {
        assert.equal(ECG_SAMPLE_RATE, reference.sample_rate);
        assert.equal(ECG_BASELINE_SAMPLES, reference.baseline_samples);
        const actual = prepareWaveform(Float64Array.from(fixture.samples), 'raw');
        const maxError = Math.max(...actual.map((value, i) => Math.abs(value - fixture.expected[i])));
        assert.ok(maxError < 3e-5, `Maximum float32 sample error: ${maxError}`);
        assert.ok(Math.abs(actual.reduce((a, b) => a + b, 0) / actual.length) < 1e-6);
    });
}

test('already-preprocessed input bypasses all filtering and normalization', () => {
    assert.deepEqual(prepareWaveform(Float64Array.from(signal), 'preprocessed'), Float32Array.from(signal));
});

test('maps independent stable sigmoid scores to the original 150-label order', () => {
    const logits = new Float32Array(150);
    logits[0] = -1000;
    logits[1] = 1000;
    const scores = scoreLogits(logits, labels);
    assert.equal(scores[0].label, 'ABNORMAL ECG');
    assert.equal(scores[1].label, 'NORMAL SINUS RHYTHM');
    assert.equal(scores[149].label, 'MULTIFOCAL ATRIAL TACHYCARDIA');
    assert.equal(scores[0].score, 0);
    assert.equal(scores[1].score, 1);
    assert.equal(scores[2].score, 0.5);
    assert.throws(() => scoreLogits(new Float32Array(149), labels));
    logits[50] = NaN;
    assert.throws(() => scoreLogits(logits, labels));
    assert.throws(() => parseLabels('one\ntwo'));
});
