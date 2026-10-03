import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repConsistency } from '../src/lib/rep-consistency.ts';
import { EmgAnalysisController } from '../src/lib/emg-analysis.ts';

const rows = (peaks) => peaks.map((peak_time, index) => ({ rep: index + 1, peak_time }));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('equal second-based peak intervals have zero timing variation', () => {
	const input = rows([0.8, 2.8, 4.8]);
	const result = repConsistency(input);
	assert.equal(result.status, 'ready');
	close(result.medianSeconds, 2);
	close(result.variationPercent, 0);
	assert.deepEqual(result.intervals.map(({ fromRep, toRep }) => [fromRep, toRep]), [[1, 2], [2, 3]]);
	result.intervals.forEach((interval) => {
		close(interval.seconds, 2);
		close(interval.medianDeviationPercent, 0);
	});
	assert.deepEqual(input, rows([0.8, 2.8, 4.8]));
});

test('uses the median and population coefficient of variation for uneven intervals', () => {
	const result = repConsistency(rows([0, 1, 4, 9]));
	assert.equal(result.status, 'ready');
	close(result.medianSeconds, 3);
	close(result.variationPercent, Math.sqrt(8 / 3) / 3 * 100);
	close(result.intervals[0].medianDeviationPercent, -200 / 3);
	close(result.intervals[1].medianDeviationPercent, 0);
	close(result.intervals[2].medianDeviationPercent, 200 / 3);
	close(repConsistency(rows([0, 1, 4])).medianSeconds, 2);
});

test('keeps fractional seconds and the original repetition labels', () => {
	const result = repConsistency([{ rep: 7, peak_time: 0.008 }, { rep: 8, peak_time: 0.024 }, { rep: 9, peak_time: 0.056 }]);
	close(result.intervals[0].seconds, 0.016);
	close(result.intervals[1].seconds, 0.032);
	close(result.medianSeconds, 0.024);
	assert.equal(result.intervals[0].fromRep, 7);
	assert.equal(result.intervals[0].toRep, 8);
});

test('explains insufficient, nonfinite, repeated and backward peak times', () => {
	for (const peaks of [[], [1], [1, 2]]) {
		const result = repConsistency(rows(peaks));
		assert.equal(result.status, 'unavailable');
		assert.match(result.reason, /three/);
	}
	for (const peaks of [[0, NaN, 2], [0, 1, Infinity], [0, 1, 1], [0, 2, 1], [-Infinity, 1, 2]]) {
		const result = repConsistency(rows(peaks));
		assert.equal(result.status, 'unavailable');
		assert.match(result.reason, /finite and strictly increasing/);
	}
});

test('extreme finite intervals do not overflow statistics', () => {
	const result = repConsistency(rows([0, 5e307, 1e308]));
	assert.equal(result.status, 'ready');
	assert.equal(result.medianSeconds, 5e307);
	assert.equal(result.variationPercent, 0);
	assert.equal(repConsistency(rows([-1e308, 1e308, 1.5e308])).status, 'unavailable');
});

test('a failed refresh retains the completed snapshot and its timing', async () => {
	let fail = false;
	let state;
	const worker = { onmessage: null, onerror: null, message: null, terminate() {}, postMessage(message) { this.message = message; } };
	const controller = new EmgAnalysisController({
		load: async () => {
			if (fail) throw new Error('offline');
			return { samples: [], reason: '', sampleCount: 1250, duration: 10, firstRecordId: 1, lastRecordId: 1250, startedAt: '', endedAt: '' };
		},
		worker: () => worker,
		urls: () => ({ modelUrl: '', metadataUrl: '', profileUrl: '' }),
		change: (next) => { state = next; }, complete() {}
	});
	await controller.analyze(1250);
	worker.onmessage({ data: { type: 'result', requestId: worker.message.requestId, rows: rows([1, 2, 4]), triggerRep: null, elapsedMs: 0, modelSha256: '' } });
	const snapshot = state.result;
	const timing = repConsistency(snapshot.rows);
	fail = true;
	await controller.analyze(2500);
	assert.equal(state.result, snapshot);
	assert.deepEqual(repConsistency(state.result.rows), timing);
	assert.match(state.error, /offline/);
	controller.dispose();
});
