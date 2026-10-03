import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EcgAnalysisController } from '../src/lib/ecg-analysis.ts';
import { ECG_SAMPLES, serializeEcgResult } from '../src/lib/ecg.ts';
import { ecgCoachNotes } from '../src/lib/ecg-coach.ts';

const window = (last = 6000) => ({ samples: Array.from({ length: ECG_SAMPLES }, (_, i) => Math.sin(i)),
	available: ECG_SAMPLES, rowCount: ECG_SAMPLES, firstRecordId: last - ECG_SAMPLES + 1, lastRecordId: last,
	startedAt: '2026-10-03T10:00:00Z', endedAt: '2026-10-03T10:00:10Z', error: '' });
function harness() {
	const changes = [], complete = [], settled = [], workers = [];
	const controller = new EcgAnalysisController({
		change: (next) => changes.push(next), complete: (next) => complete.push(next), settled: (success) => settled.push(success),
		urls: () => ({ modelUrl: 'model', labelsUrl: 'labels' }),
		worker: () => {
			const worker = { onmessage: null, onerror: null, messages: [], terminated: false,
				postMessage(message) { this.messages.push(message); }, terminate() { this.terminated = true; } };
			workers.push(worker); return worker;
		} });
	const reply = (extra = {}, worker = workers.at(-1)) => worker.onmessage({ data: { type: 'result',
		requestId: worker.messages.at(-1).requestId, scores: [{ index: 5, label: 'ATRIAL FIBRILLATION', logit: 2, score: .9 }], elapsedMs: 20, ...extra } });
	return { controller, changes, complete, settled, workers, reply };
}

test('result provenance belongs to the completed input; old scores remain during refresh and errors', () => {
	const h = harness(), input = window();
	h.controller.analyze(input); h.reply();
	const original = h.complete[0];
	input.lastRecordId = 9999;
	assert.equal(original.window.lastRecordId, 6000);
	h.controller.analyze(window(7000)); assert.equal(h.changes.at(-1).result, original);
	h.reply({ type: 'error', text: 'offline' });
	assert.equal(h.changes.at(-1).result, original); assert.deepEqual(h.settled, [true, false]);
	assert.equal(h.workers[0].terminated, true);
	h.controller.analyze(window(8000)); h.reply({ scores: [] });
	assert.equal(h.complete.at(-1).window.lastRecordId, 8000);
	assert.deepEqual(ecgCoachNotes(h.complete.at(-1), []), []);
});

test('wrong, duplicate, and disposed messages do not publish or change state; successful workers are reused', () => {
	const h = harness(); h.controller.analyze(window()); h.controller.analyze(window(7000));
	assert.equal(h.workers[0].messages.length, 1);
	h.reply({ requestId: 999 }); assert.equal(h.complete.length, 0);
	h.reply(); h.reply(); assert.equal(h.complete.length, 1);
	h.controller.analyze(window(7000)); assert.equal(h.workers.length, 1);
	h.reply({ requestId: 1 }); assert.equal(h.complete.length, 1);
	h.reply(); assert.equal(h.complete.length, 2);
	h.controller.analyze(window(8000)); h.controller.dispose(); h.reply();
	assert.equal(h.complete.length, 2); assert.equal(h.workers[0].terminated, true);
});

test('worker exceptions retain the previous result and replace the worker for retry', () => {
	const h = harness(); h.controller.analyze(window()); h.reply();
	h.controller.analyze(window(7000)); h.workers[0].onerror();
	assert.equal(h.changes.at(-1).result, h.complete[0]);
	assert.deepEqual(h.settled, [true, false]);
	h.controller.analyze(window(7000)); assert.equal(h.workers.length, 2); h.reply();
});

test('short, flat, and invalid waveforms produce unavailable results and clear findings without downloading the model', () => {
	for (const input of [ { ...window(), samples: [], available: 100 },
		{ ...window(), samples: Array(ECG_SAMPLES).fill(1) }, { ...window(), samples: Array(ECG_SAMPLES).fill(NaN) } ]) {
		const h = harness(); h.controller.analyze(window()); h.reply();
		h.controller.analyze(input);
		assert.equal(h.complete.at(-1).status, 'unavailable');
		assert.deepEqual(ecgCoachNotes(h.complete.at(-1), []), []);
		assert.equal(h.workers[0].messages.length, 1); assert.deepEqual(h.settled, [true, true]);
	}
});

test('all ECG export scores retain model order, logits, input assumptions and original provenance', () => {
	const h = harness(); h.controller.analyze(window()); h.reply();
	const report = JSON.parse(serializeEcgResult(h.complete[0]));
	assert.equal(report.firstRecordId, 6001 - ECG_SAMPLES); assert.equal(report.lastRecordId, 6000);
	assert.equal(report.assumedSampleRate, 2000); assert.equal(report.samples, ECG_SAMPLES);
	assert.equal(report.modelSamples, 5000); assert.match(report.resampling, /2000 Hz to 500 Hz/);
	assert.equal(report.assumedLead, 'I'); assert.equal(report.source, 'public.ekgemgpuls.ekg');
	assert.deepEqual(report.scores, h.complete[0].scores); assert.match(report.validation, /Unvalidated.*500 Hz/);
});

test('cancel stops a run, keeps the previous result and lets the next run start a fresh worker', () => {
	const h = harness(); h.controller.analyze(window()); h.reply();
	h.controller.analyze(window(7000)); h.controller.cancel();
	assert.equal(h.changes.at(-1).busy, false); assert.equal(h.changes.at(-1).result, h.complete[0]);
	assert.match(h.changes.at(-1).status, /canceled/); assert.equal(h.workers[0].terminated, true);
	h.reply({}, h.workers[0]); assert.equal(h.complete.length, 1);
	h.controller.cancel(); assert.match(h.changes.at(-1).status, /canceled/);
	h.controller.analyze(window(7000)); assert.equal(h.workers.length, 2); h.reply();
	assert.equal(h.complete.at(-1).window.lastRecordId, 7000);
});
