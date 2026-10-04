import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EmgAnalysisController } from '../src/lib/emg-analysis.ts';
import { emgResult, serializeEmgResult } from '../src/lib/emg.ts';
import { emgCoachNote } from '../src/lib/emg-coach.ts';

const window = (last = 40000) => ({ samples: Array(20000).fill(1), sampleCount: 20000, duration: 10,
    firstRecordId: last - 19999, lastRecordId: last, startedAt: '2026-10-03T10:00:00Z', endedAt: '2026-10-03T10:00:10Z', reason: '' });
function harness(load = async (id) => window(id)) {
    const changes = [], complete = [], workers = [];
    const controller = new EmgAnalysisController({ load, change: (next) => changes.push(next), complete: (next) => complete.push(next),
        urls: () => ({ modelUrl: 'model', metadataUrl: 'metadata', profileUrl: 'profile' }),
        worker: () => {
            const worker = { onmessage: null, onerror: null, messages: [], terminated: false,
                postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
            workers.push(worker); return worker;
        } });
    const reply = (extra, worker = workers.at(-1)) => worker.onmessage({ data: {
        type: 'result', requestId: worker.messages.at(-1).requestId, rows: [{ rep: 1, proba: .9 }], triggerRep: 1, elapsedMs: 20, modelSha256: 'hash', ...extra } });
    return { controller, changes, complete, workers, reply };
}

test('analysis retains original range through refresh/retry failure and replaces only on completion', async () => {
    let failing = false;
    const h = harness(async (id) => { if (failing) throw new Error('offline'); return window(id); });
    await h.controller.analyze(40000);
    h.reply({});
    const original = h.complete[0];
    failing = true;
    await h.controller.analyze(50000);
    assert.equal(h.changes.at(-1).result, original);
    assert.match(h.changes.at(-1).error, /offline/);
    assert.equal(h.complete.length, 1);
    failing = false;
    await h.controller.analyze(60000);
    h.reply({ triggerRep: null });
    assert.equal(h.complete.at(-1).window.lastRecordId, 60000);
    assert.equal(h.workers.length, 2, 'failed worker is replaced for retry');
});

test('cancel aborts a pending fetch, and late data cannot create a worker', async () => {
    let resolve, signal;
    const h = harness((_id, abort) => { signal = abort; return new Promise((done) => { resolve = done; }); });
    const pending = h.controller.analyze(40000);
    h.controller.cancel();
    assert.equal(signal.aborted, true);
    resolve(window()); await pending;
    assert.equal(h.workers.length, 0);
    assert.equal(h.complete.length, 0);
    assert.match(h.changes.at(-1).status, /canceled/);
});

test('cancel terminates inference, stale messages are ignored, retry starts a fresh worker', async () => {
    const h = harness();
    await h.controller.analyze(40000);
    const worker = h.workers[0];
    h.controller.cancel();
    assert.equal(worker.terminated, true);
    h.reply({}, worker);
    assert.equal(h.complete.length, 0);
    await h.controller.analyze(50000);
    h.reply({}, worker);
    assert.equal(h.complete.length, 0);
    h.reply({});
    assert.equal(h.complete[0].window.lastRecordId, 50000);
    h.controller.dispose();
    assert.equal(h.workers[1].terminated, true);
});

test('worker is reused on success; duplicate Analyze and wrong request IDs do not replace results', async () => {
    const h = harness();
    await h.controller.analyze(40000);
    await h.controller.analyze(50000);
    assert.equal(h.workers[0].messages.length, 1);
    h.reply({ requestId: 999 });
    assert.equal(h.complete.length, 0);
    h.reply({});
    await h.controller.analyze(50000);
    assert.equal(h.workers.length, 1);
    h.reply({ type: 'error', text: 'bad model' });
    assert.equal(h.changes.at(-1).result.window.lastRecordId, 40000);
    assert.equal(h.workers[0].terminated, true);
});

test('successful insufficient-data outcomes clear fatigue notes without launching a model', async () => {
    const h = harness(async () => ({ ...window(), reason: 'Too short' }));
    await h.controller.analyze(40000);
    assert.equal(h.workers.length, 0);
    assert.equal(h.complete[0].status, 'unavailable');
    assert.deepEqual(emgCoachNote(h.complete[0], []), []);
    const ready = harness();
    await ready.controller.analyze(40000);
    ready.reply({ type: 'unavailable', reason: 'Only two repetitions', elapsedMs: 10 });
    assert.equal(ready.complete[0].status, 'unavailable');
    assert.deepEqual(ready.complete[0].rows, []);
});

test('coach notes identify experimental snapshot, clip links to visible overlap, and clear on no trigger', () => {
    const { samples, reason, ...info } = window();
    const result = emgResult(info, { status: 'ready', triggerRep: 3 });
    const readings = [39999, 40000, 40001].map((id) => ({ id }));
    const [note] = emgCoachNote(result, readings);
    assert.match(note.text, /fatigue at rep 3\. Experimental and unvalidated.*Newer readings.*Analyze EMG again/);
    assert.equal(note.fromId, 39999);
    assert.equal(note.toId, 40000);
    assert.equal(note.from, info.startedAt);
    const historical = emgCoachNote(result, [{ id: 50000 }])[0];
    assert.equal(historical.fromId, undefined);
    assert.deepEqual(emgCoachNote({ ...result, triggerRep: null }, readings), []);
    assert.deepEqual(emgCoachNote(null, readings), []);
});

test('JSON exports retain model context, original record provenance and all repetition features', () => {
    const { samples, reason, ...info } = window();
    const result = emgResult(info, { status: 'ready', rows: [{ rep: 1, proba: .75, rms: 12 }], triggerRep: 1, modelSha256: 'hash' });
    const report = JSON.parse(serializeEmgResult(result));
    assert.equal(report.window.firstRecordId, 20001);
    assert.equal(report.sampleRate, 2000);
    assert.equal(report.profile, 'upstream-2000hz');
    assert.equal(report.experimental, true);
    assert.match(report.validation, /unvalidated/);
    assert.deepEqual(report.rows, result.rows);
    assert.equal(report.threshold, .58);
    assert.equal(report.triggerM, 2);
    assert.equal(report.triggerN, 3);
    assert.equal(report.source, 'public.ekgemgpuls.emg');
    assert.equal(report.window.samples, undefined);
});
