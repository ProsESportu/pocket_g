import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisMonitor } from '../src/lib/analysis-monitor.ts';

function harness() {
	let now = 0, id = 0;
	const timers = new Map(), runs = [], changes = [];
	const monitor = new AnalysisMonitor({ run: (snapshot) => runs.push(snapshot), change: (next) => changes.push(next),
		now: () => now,
		setTimer: (callback, delay) => { timers.set(++id, { at: now + delay, callback }); return id; },
		clearTimer: (timer) => timers.delete(timer) });
	const observe = (snapshot, enabled = true, manualRequest = 0) => monitor.observe({ snapshot, key: String(snapshot), enabled, manualRequest });
	const advance = (duration) => {
		const end = now + duration;
		while (true) {
			const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			now = due[1].at; timers.delete(due[0]); due[1].callback();
		}
		now = end;
	};
	return { monitor, runs, changes, timers, observe, advance };
}

test('starts on the initial snapshot, skips unchanged windows, keeps only the latest pending snapshot', () => {
	const h = harness();
	h.observe(1); h.observe(1); h.observe(2); h.observe(3);
	assert.deepEqual(h.runs, [1]);
	h.monitor.complete(true);
	assert.deepEqual(h.runs, [1, 3]);
	h.monitor.complete(true); h.observe(3);
	assert.deepEqual(h.runs, [1, 3]);
});

test('pause permits the active run to finish, stops queued runs, resume uses the latest snapshot', () => {
	const h = harness();
	h.observe(1); h.observe(2, false); h.monitor.complete(true); h.advance(100000);
	assert.deepEqual(h.runs, [1]);
	h.observe(3, false); h.observe(3);
	assert.deepEqual(h.runs, [1, 3]);
});

test('manual refresh while paused runs one pass, including unchanged data, without resuming', () => {
	const h = harness();
	h.observe(1); h.monitor.complete(true);
	h.observe(1, false, 1); h.observe(2, false, 1); h.monitor.complete(true); h.advance(100000);
	assert.deepEqual(h.runs, [1, 1]);
	h.observe(2, false, 2);
	assert.deepEqual(h.runs, [1, 1, 2]);
});

test('a manual request queued during inference uses the latest snapshot exactly once', () => {
	const h = harness();
	h.observe(1); h.observe(2, false, 1); h.observe(3, false, 1); h.monitor.complete(true);
	assert.deepEqual(h.runs, [1, 3]);
	h.observe(4, false, 1); h.monitor.complete(true);
	assert.deepEqual(h.runs, [1, 3]);
});

test('failure backoff is 5, 10, 20, 40, then 60 seconds and successful replacement resets it', () => {
	const h = harness(); h.observe(1);
	for (const delay of [5000, 10000, 20000, 40000, 60000, 60000]) {
		const count = h.runs.length;
		h.monitor.complete(false); h.observe(count + 1);
		h.advance(delay - 1); assert.equal(h.runs.length, count);
		h.advance(1); assert.equal(h.runs.length, count + 1);
		assert.equal(h.runs.at(-1), count + 1);
	}
	h.monitor.complete(true); h.observe(99); h.monitor.complete(false);
	const count = h.runs.length; h.advance(5000);
	assert.equal(h.runs.length, count + 1);
});

test('a failed rerun of a completed snapshot is retried while enabled', () => {
	const h = harness(); h.observe(1); h.monitor.complete(true);
	h.observe(1, true, 1); h.monitor.complete(false); h.advance(5000);
	assert.deepEqual(h.runs, [1, 1, 1]);
});

test('source failures block scheduling, and recovery retries the latest snapshot', () => {
	const h = harness(); h.observe(1); h.observe(null); h.monitor.complete(false); h.advance(100000);
	assert.deepEqual(h.runs, [1]); assert.equal(h.timers.size, 0);
	h.observe(2); assert.deepEqual(h.runs, [1, 2]);
});

test('pause cancels the retry timer and resume respects the remaining backoff', () => {
	const h = harness(); h.observe(1); h.monitor.complete(false); h.advance(1000);
	h.observe(2, false); assert.equal(h.timers.size, 0);
	h.advance(1000); h.observe(3); h.advance(2999); assert.deepEqual(h.runs, [1]);
	h.advance(1); assert.deepEqual(h.runs, [1, 3]);
});

test('models progress independently and disposal ignores late completions and cancels retries', () => {
	const ecg = harness(), emg = harness();
	ecg.observe(1); emg.observe(1); emg.monitor.complete(true); emg.observe(2);
	assert.deepEqual(ecg.runs, [1]); assert.deepEqual(emg.runs, [1, 2]);
	ecg.monitor.complete(false); ecg.monitor.dispose(); ecg.advance(100000); ecg.monitor.complete(true); ecg.observe(2);
	assert.deepEqual(ecg.runs, [1]); assert.equal(ecg.timers.size, 0);
});
