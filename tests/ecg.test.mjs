import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ECG_SAMPLES, ECG_SAMPLE_RATE, ECG_BASELINE_SAMPLES, ECG_MODEL_SAMPLES, parseLabels, validateWaveform, scoreLogits } from '../src/lib/ecg.ts';
import { modelInput, prepareWaveform, upsample } from '../src/lib/ecg-preprocessing.ts';

const labels = parseLabels(readFileSync(new URL('../static/models/ecgfounder/tasks.txt', import.meta.url), 'utf8'));
const reference = JSON.parse(readFileSync(new URL('./fixtures/ecg-preprocessing.json', import.meta.url), 'utf8'));
// The fixtures hold 40 s for SciPy parity; the model window is the first 10 s of them.
const signal = reference.cases[0].samples.slice(0, ECG_SAMPLES);

test('accepts a complete database ECG window without altering samples', () => {
    assert.deepEqual(Array.from(validateWaveform(signal)), signal);
});

test('rejects missing, nonfinite, flat or multichannel database waveforms', () => {
    const bad = [[], signal.slice(1), [...signal, 1], Array(ECG_SAMPLES).fill(1), signal.map((x, i) => i === 50 ? null : x), signal.map((x, i) => i === 50 ? '2' : x), signal.map((x, i) => i === 50 ? Infinity : x), [signal]];
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

test('upsampling keeps every original sample and reconstructs a smooth wave between them', () => {
    const rate = ECG_SAMPLE_RATE, wave = (t) => Math.sin(2 * Math.PI * 7 * t) + 0.5 * Math.sin(2 * Math.PI * 23 * t);
    const original = Array.from({ length: 250 }, (_, i) => wave(i / rate));
    const result = upsample(original, 4);
    assert.equal(result.length, 1000);
    original.forEach((value, i) => assert.equal(result[i * 4], value));
    // Away from the edges, in-between points match the true wave closely.
    const error = Math.max(...Array.from({ length: 800 }, (_, i) => Math.abs(result[i + 100] - wave((i + 100) / (rate * 4)))));
    assert.ok(error < 0.03, `max interpolation error ${error}`);
});

test('model input is the 10-second window upsampled to 5,000 standardized samples', () => {
    const input = modelInput(Float64Array.from(signal));
    assert.equal(input.length, ECG_MODEL_SAMPLES);
    const mean = input.reduce((a, b) => a + b, 0) / input.length;
    const std = Math.sqrt(input.reduce((a, b) => a + (b - mean) ** 2, 0) / input.length);
    assert.ok(Math.abs(mean) < 1e-6 && Math.abs(std - 1) < 1e-4, `mean ${mean}, std ${std}`);
    assert.throws(() => modelInput(Float64Array.from(reference.cases[0].samples)));
});
