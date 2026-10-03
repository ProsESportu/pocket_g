import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as ort from 'onnxruntime-web/wasm';
import { processSignal, medianFrequency, findPeaks } from '../src/lib/emg-preprocessing.ts';
import { predictRows, applyTrigger, featureMatrix, validateMetadata, validateProfile } from '../src/lib/emg-prediction.ts';

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const metadata = validateMetadata(await json('../static/models/emg-fatigue/metadata.json'));
const profile = validateProfile(await json('../static/models/emg-fatigue/experimental-125hz.json'));
const fixture = await json('./fixtures/emg-preprocessing.json');
const modelFixture = await json('./fixtures/emg-model-parity.json');

for (const ref of fixture.signals) test(`125 Hz SciPy parity: ${ref.name}, including filter edges and all 24 features`, () => {
    const result = processSignal(Float64Array.from(ref.samples), profile);
    const close = (actual, expected, name) => assert.ok(Math.abs(actual - expected) <= 1e-10 + 1e-9 * Math.abs(expected), `${name}: ${actual} vs ${expected}`);
    assert.deepEqual(result.peaks, ref.peaks);
    assert.equal(result.rows.length, ref.rows.length);
    result.filtered.forEach((value, i) => close(value, ref.filtered[i], `filtered sample ${i}`));
    result.env.forEach((value, i) => close(value, ref.env[i], `envelope sample ${i}`));
    result.rows.forEach((row, i) => {
        assert.deepEqual(Object.keys(row).sort(), metadata.feature_cols.toSorted());
        for (const [column, value] of Object.entries(ref.rows[i])) close(row[column], value, `rep ${i + 1} ${column}`);
    });
});
for (const ref of fixture.mdf) test(`125 Hz Welch parity with ${ref.samples.length} samples`, () => {
    assert.ok(Math.abs(medianFrequency(Float64Array.from(ref.samples), 125) - ref.expected) < 1e-12);
});

test('EMG model hash and exact feature order are preserved', async () => {
    const model = await readFile(new URL('../static/models/emg-fatigue/fatigue.onnx', import.meta.url));
    assert.equal(createHash('sha256').update(model).digest('hex'), metadata.model_sha256);
    assert.equal(model.byteLength, 692);
    assert.deepEqual(modelFixture.columns, metadata.feature_cols);
    assert.throws(() => validateMetadata({ ...metadata, feature_cols: metadata.feature_cols.toReversed() }), /feature order/);
    assert.throws(() => validateProfile({ ...profile, sample_rate: 2000 }), /profile/);
});

test('feature order and invalid values are enforced; no zero-filled missing features', () => {
    assert.deepEqual([...featureMatrix([{ a: 1, b: 2 }], ['b', 'a'])], [2, 1]);
    for (const value of [NaN, Infinity, 1e100, undefined]) assert.throws(() => featureMatrix([{ rms: value }], ['rms']), /invalid/);
    assert.throws(() => processSignal(new Float64Array(31), profile), /32/);
    assert.throws(() => processSignal(Float64Array.from({ length: 1250 }, () => NaN), profile), /non-finite/);
});

test('2-of-3 trigger includes partial windows, uses >= 0.58 and retains first trigger', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ rep: i + 1 }));
    assert.equal(applyTrigger(rows, [.58, .58, 0, 1, 1], metadata).triggerRep, 2);
    assert.equal(applyTrigger(rows, [.58, 0, .58, 0, 0], metadata).triggerRep, 3);
    assert.equal(applyTrigger(rows, [.57, 0, .57, 0, 0], metadata).triggerRep, null);
    assert.deepEqual(applyTrigger([], [], metadata), { rows: [], triggerRep: null });
    assert.throws(() => applyTrigger(rows, [], metadata), /length/);
    assert.throws(() => applyTrigger([{ rep: 1 }], [NaN], metadata), /invalid probability/);
    assert.deepEqual(findPeaks([0, 1, 1, 1, 0, 2, 0], 1, 0), [2, 5]);
});

let session;
after(async () => { await session?.release(); });
test('ONNX Runtime Web 1.30: all 420 upstream probabilities, decisions and per-session triggers match', async (t) => {
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = {
        mjs: pathToFileURL(resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs')).href,
        wasm: pathToFileURL(resolve('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm')).href
    };
    session = await ort.InferenceSession.create(new Uint8Array(await readFile(new URL('../static/models/emg-fatigue/fatigue.onnx', import.meta.url))), { executionProviders: ['wasm'] });
    const result = await predictRows(ort, session, modelFixture.rows, metadata);
    let maxError = 0;
    result.rows.forEach((row, i) => {
        const error = Math.abs(row.proba - modelFixture.expected_proba[i]);
        maxError = Math.max(maxError, error);
        assert.ok(error <= 2e-6, `row ${i + 1}: ${error}`);
        assert.equal(row.pred, Number(modelFixture.expected_proba[i] >= metadata.best_threshold));
        assert.equal(row.proba_used, row.proba);
    });
    for (const id of new Set(modelFixture.file_ids)) {
        const indices = modelFixture.file_ids.flatMap((value, i) => value === id ? [i] : []);
        const rows = indices.map((i) => modelFixture.rows[i]);
        assert.equal(applyTrigger(rows, indices.map((i) => result.rows[i].proba), metadata).triggerRep,
            applyTrigger(rows, indices.map((i) => modelFixture.expected_proba[i]), metadata).triggerRep);
    }
    t.diagnostic(`Maximum probability error: ${maxError}`);
});
