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

const unexpectedWebGl = async () => { throw new Error('WebGL should not be attempted'); };

test('prefers WebGPU with WASM operator fallback and preserves model bytes', async () => {
    const model = new Uint8Array([1, 2, 3]);
    const session = {};
    const calls = [];
    const actual = await createEcgSession(model, async (bytes, options) => {
        assert.equal(bytes, model);
        calls.push(options.executionProviders);
        return session;
    }, true, () => {}, unexpectedWebGl);
    assert.equal(actual, session);
    assert.deepEqual(calls, [['webgpu', 'wasm']]);
});

test('uses WebGL when WebGPU is unavailable, without initializing WASM', async () => {
    const model = new Uint8Array([1]);
    const session = {};
    const statuses = [];
    const actual = await createEcgSession(model, async () => {
        assert.fail('WASM should not be attempted');
    }, false, (text) => statuses.push(text), async (bytes, options) => {
        assert.equal(bytes, model);
        assert.deepEqual(options.executionProviders, ['webgl']);
        return session;
    });
    assert.equal(actual, session);
    assert.match(statuses[0], /WebGPU is unavailable.*WebGL/);
});

test('retries WebGPU initialization failures on WebGL using the same model bytes', async () => {
    const model = new Uint8Array([1]);
    const calls = [];
    const statuses = [];
    const session = {};
    const actual = await createEcgSession(model, async (bytes, options) => {
        assert.equal(bytes, model);
        calls.push(options.executionProviders);
        throw new Error('GPU adapter cannot load model');
    }, true, (text) => statuses.push(text), async (bytes, options) => {
        assert.equal(bytes, model);
        calls.push(options.executionProviders);
        return session;
    });
    assert.equal(actual, session);
    assert.deepEqual(calls, [['webgpu', 'wasm'], ['webgl']]);
    assert.match(statuses[1], /WebGPU initialization failed.*WebGL/);
});

test('falls back to CPU if WebGL cannot initialize, with or without WebGPU', async () => {
    const model = new Uint8Array([1]);
    for (const hasWebGpu of [false, true]) {
        const calls = [];
        const statuses = [];
        const cpuSession = {};
        const actual = await createEcgSession(model, async (bytes, options) => {
            assert.equal(bytes, model);
            calls.push(options.executionProviders);
            if (options.executionProviders.includes('webgpu')) throw new Error('WebGPU unavailable');
            return cpuSession;
        }, hasWebGpu, (text) => statuses.push(text), async (bytes, options) => {
            assert.equal(bytes, model);
            calls.push(options.executionProviders);
            throw new Error('WebGL context or model operators unavailable');
        });
        assert.equal(actual, cpuSession);
        assert.deepEqual(calls, hasWebGpu ? [['webgpu', 'wasm'], ['webgl'], ['wasm']] : [['webgl'], ['wasm']]);
        assert.match(statuses.at(-1), /WebGL initialization failed.*CPU/);
    }
});

test('handles a failed lazy WebGL import by falling back to CPU', async () => {
    const cpuSession = {};
    const actual = await createEcgSession(new Uint8Array(), async (_, options) => {
        assert.deepEqual(options.executionProviders, ['wasm']);
        return cpuSession;
    }, false, () => {}, async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    assert.equal(actual, cpuSession);
});

test('propagates CPU failures so the existing worker error handler can report them', async () => {
    const failure = new Error('Model is invalid');
    for (const hasWebGpu of [false, true]) {
        await assert.rejects(createEcgSession(new Uint8Array(), async () => {
            throw failure;
        }, hasWebGpu, () => {}, async () => { throw new Error('WebGL unavailable'); }), (error) => error === failure);
    }
});
