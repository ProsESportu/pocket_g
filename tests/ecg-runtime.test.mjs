import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEcgSession, runEcgSession } from '../src/lib/ecg-runtime.ts';

test('GPU and CPU entries bundle their matching WASM/glue assets', async () => {
    for (const [file, gpu] of [['ecg.worker.ts', true], ['ecg-cpu-runtime.ts', false]]) {
        const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), 'utf8');
        const wasmPath = source.match(/import wasmUrl from '([^']+)\?url'/)?.[1];
        const modulePath = source.match(/import wasmModuleUrl from '([^']+)\?url'/)?.[1];
        assert.ok(wasmPath && modulePath);
        const { default: factory } = await import(modulePath);
        const runtime = await factory({ wasmBinary: readFileSync(new URL(import.meta.resolve(wasmPath))), numThreads: 1 });
        assert.equal(typeof runtime._OrtInit, 'function');
        if (gpu) assert.equal(typeof runtime.webgpuInit, 'function');
    }
});

test('prefers WebGPU with WASM operator fallback', async () => {
    const model = new Uint8Array([1]);
    const session = {};
    const actual = await createEcgSession(model, async (bytes, options) => {
        assert.equal(bytes, model);
        assert.deepEqual(options.executionProviders, ['webgpu', 'wasm']);
        return session;
    }, true, () => {}, async () => assert.fail('CPU fallback should not be attempted'));
    assert.equal(actual, session);
});

test('missing or failing WebGPU uses a separate CPU runtime with the same model', async () => {
    for (const available of [false, true]) {
        const model = new Uint8Array([1]);
        const cpuSession = {};
        const statuses = [];
        let gpuCalls = 0;
        const actual = await createEcgSession(model, async () => {
            gpuCalls++;
            throw new Error('GPU initialization failed');
        }, available, text => statuses.push(text), async (bytes, options) => {
            assert.equal(bytes, model);
            assert.deepEqual(options.executionProviders, ['wasm']);
            return cpuSession;
        });
        assert.equal(actual, cpuSession);
        assert.equal(gpuCalls, Number(available));
        assert.match(statuses.at(-1), /CPU/);
    }
});

test('initialization reports CPU failures', async () => {
    const error = new Error('CPU failure');
    await assert.rejects(createEcgSession(new Uint8Array(), async () => assert.fail(), false, () => {}, async () => { throw error; }), e => e === error);
});

test('GPU execution failure releases the GPU session and retries the waveform on CPU', async () => {
    const events = [];
    const gpu = { release: async () => events.push('release GPU') };
    const cpu = {};
    const output = {};
    const result = await runEcgSession(gpu, async session => {
        if (session === gpu) { events.push('run GPU'); throw new Error('Unsupported convolution'); }
        assert.equal(session, cpu);
        events.push('run CPU');
        return output;
    }, async () => { events.push('create CPU'); return cpu; }, true, text => assert.match(text, /Retrying analysis on CPU/));
    assert.deepEqual(events, ['run GPU', 'release GPU', 'create CPU', 'run CPU']);
    assert.equal(result.session, cpu);
    assert.equal(result.output, output);
});

test('successful inference reuses its session without creating a CPU session', async () => {
    const session = {};
    const output = {};
    const result = await runEcgSession(session, async () => output, async () => assert.fail(), true, () => assert.fail());
    assert.deepEqual(result, { session, output });
});

test('CPU execution failure is reported without a retry loop', async () => {
    const error = new Error('Out of memory');
    await assert.rejects(runEcgSession({}, async () => { throw error; }, async () => assert.fail(), false, () => assert.fail()), e => e === error);
});

test('failed CPU retry releases its session and preserves the CPU error', async () => {
    let released = false;
    const error = new Error('CPU out of memory');
    const cpu = { release: async () => { released = true; } };
    await assert.rejects(runEcgSession({ release: async () => {} }, async session => {
        if (session === cpu) throw error;
        throw new Error('GPU failure');
    }, async () => cpu, true, () => {}), e => e === error);
    assert.equal(released, true);
});
