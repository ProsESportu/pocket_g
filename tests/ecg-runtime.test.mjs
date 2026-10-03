import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEcgSession } from '../src/lib/ecg-runtime.ts';

test('worker runtime assets initialize WASM with the native WebGPU entry point', async () => {
    const worker = readFileSync(new URL('../src/lib/ecg.worker.ts', import.meta.url), 'utf8');
    const wasmPath = worker.match(/import wasmUrl from '([^']+)\?url'/)?.[1];
    const modulePath = worker.match(/import wasmModuleUrl from '([^']+)\?url'/)?.[1];
    assert.ok(wasmPath && modulePath, 'worker must explicitly bundle both runtime assets');
    const { default: factory } = await import(modulePath);
    const runtime = await factory({
        wasmBinary: readFileSync(new URL(import.meta.resolve(wasmPath))),
        numThreads: 1
    });
    assert.equal(typeof runtime.webgpuInit, 'function', 'WebGPU JS requires a compatible WASM glue module');
    assert.equal(typeof runtime.asyncInit, 'function');
});

test('prefers WebGPU with WASM operator fallback and preserves model bytes', async () => {
    const model = new Uint8Array([1, 2, 3]);
    const session = {};
    const calls = [];
    const actual = await createEcgSession(model, async (bytes, options) => {
        assert.equal(bytes, model);
        calls.push(options.executionProviders);
        return session;
    }, true, () => {});
    assert.equal(actual, session);
    assert.deepEqual(calls, [['webgpu', 'wasm']]);
});

test('uses CPU directly when WebGPU is unavailable in the worker', async () => {
    const calls = [];
    const statuses = [];
    await createEcgSession(new Uint8Array(), async (_, options) => {
        calls.push(options.executionProviders);
        return {};
    }, false, (text) => statuses.push(text));
    assert.deepEqual(calls, [['wasm']]);
    assert.match(statuses[0], /WebGPU is unavailable/);
});

test('retries GPU session failures on CPU without downloading the model again', async () => {
    const model = new Uint8Array([1]);
    const calls = [];
    const statuses = [];
    const cpuSession = {};
    const actual = await createEcgSession(model, async (bytes, options) => {
        assert.equal(bytes, model);
        calls.push(options.executionProviders);
        if (calls.length === 1) throw new Error('GPU adapter cannot load model');
        return cpuSession;
    }, true, (text) => statuses.push(text));
    assert.equal(actual, cpuSession);
    assert.deepEqual(calls, [['webgpu', 'wasm'], ['wasm']]);
    assert.match(statuses[1], /GPU initialization failed/);
});

test('propagates CPU failures so the existing worker error handler can report them', async () => {
    const failure = new Error('Model is invalid');
    for (const hasWebGpu of [false, true]) {
        await assert.rejects(createEcgSession(new Uint8Array(), async () => {
            throw failure;
        }, hasWebGpu, () => {}), (error) => error === failure);
    }
});
