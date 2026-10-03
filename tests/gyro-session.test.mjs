import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GyroSession } from '../src/lib/gyro-session.ts';

const row = (id) => ({ id, created_at: '2026-10-03T12:00:00Z', gyro_x: 0, gyro_y: 1, gyro_z: 0 });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((resolve) => setImmediate(resolve));
function sessionMock(load, latest = async () => 376, baselineId = null) {
	const changes = [];
	const session = new GyroSession({ load, latest, change: (next) => changes.push(next) }, baselineId);
	return { session, changes };
}

test('only commits complete snapshots, advances the cursor and avoids duplicate counting', async () => {
	const afterIds = [];
	const { session } = sessionMock(async (afterId) => {
		afterIds.push(afterId);
		return { readings: afterId === 0 ? [row(1), row(2)] : [], throughId: 2 };
	});
	await session.refresh();
	await session.refresh();
	assert.deepEqual(afterIds, [0, 2]);
	assert.deepEqual(session.state.readings.map((row) => row.id), [1, 2]);
	assert.equal(session.state.hasLoaded, true);
});

test('a failed load retains the previous snapshot/cursor and a successful retry clears the error', async () => {
	let fail = false;
	const { session } = sessionMock(async (afterId) => {
		if (fail) throw new Error('network failed');
		return { readings: afterId === 0 ? [row(1)] : [row(2)], throughId: afterId === 0 ? 1 : 2 };
	});
	await session.refresh();
	const snapshot = session.state.readings;
	fail = true;
	await session.refresh();
	assert.equal(session.state.readings, snapshot);
	assert.equal(session.state.throughId, 1);
	assert.equal(session.state.error, 'network failed');
	assert.equal(session.state.busy, false);
	fail = false;
	await session.refresh();
	assert.equal(session.state.error, '');
	assert.equal(session.state.throughId, 2);
	assert.deepEqual(session.state.readings.map((row) => row.id), [1, 2]);
	session.dispose();
});

test('coalesces refresh requests into one pending load and pause cancels pending automatic work', async () => {
	const first = deferred();
	let calls = 0;
	const { session } = sessionMock(async () => { calls++; return first.promise; });
	const running = session.refresh();
	await session.refresh();
	await session.refresh();
	assert.equal(calls, 1);
	session.setMonitoring(false);
	first.resolve({ readings: [row(1)], throughId: 1 });
	await running;
	await tick();
	assert.equal(calls, 1);
	assert.equal(session.state.hasLoaded, true);
	await session.refresh();
	assert.equal(calls, 1);
	session.dispose();
});

test('manual refresh remains available while paused, including a queued manual request', async () => {
	const first = deferred();
	let calls = 0;
	const { session } = sessionMock(async (afterId) => {
		calls++;
		return calls === 1 ? first.promise : { readings: [row(afterId + 1)], throughId: afterId + 1 };
	});
	const running = session.refresh();
	await session.refresh(true);
	session.setMonitoring(false);
	first.resolve({ readings: [row(1)], throughId: 1 });
	await running;
	await tick();
	assert.equal(calls, 2);
	assert.deepEqual(session.state.readings.map((row) => row.id), [1, 2]);
	await session.refresh(true);
	assert.equal(calls, 3);
	assert.deepEqual(session.state.readings.map((row) => row.id), [1, 2, 3]);
});

test('reset cancels old refreshes and late results cannot restore excluded rows', async () => {
	const old = deferred(), boundary = deferred();
	let signal;
	const { session } = sessionMock(async (_afterId, nextSignal) => { signal = nextSignal; return old.promise; }, () => boundary.promise);
	const running = session.refresh();
	const resetting = session.reset();
	assert.equal(signal.aborted, true);
	boundary.resolve(376);
	await resetting;
	assert.equal(session.state.baselineId, 376);
	assert.equal(session.state.throughId, 376);
	assert.deepEqual(session.state.readings, []);
	old.resolve({ readings: [row(1)], throughId: 1 });
	await running;
	assert.deepEqual(session.state.readings, []);
	assert.equal(session.state.throughId, 376);
	assert.equal(session.state.busy, false);
});

test('failed reset preserves readings, cursor and previous baseline', async () => {
	const { session } = sessionMock(async () => ({ readings: [row(377)], throughId: 377 }), async () => { throw new Error('offline'); }, 376);
	await session.refresh();
	const readings = session.state.readings;
	await session.reset();
	assert.equal(session.state.readings, readings);
	assert.equal(session.state.throughId, 377);
	assert.equal(session.state.baselineId, 376);
	assert.match(session.state.error, /Reset failed.*offline.*session was kept/);
});

test('a restored boundary fetches only future rows; successful reset starts a zero session', async () => {
	const afterIds = [];
	const { session } = sessionMock(async (afterId) => { afterIds.push(afterId); return { readings: [row(afterId + 1)], throughId: afterId + 1 }; }, async () => 500, 376);
	await session.refresh();
	assert.deepEqual(afterIds, [376]);
	await session.reset();
	assert.deepEqual(session.state.readings, []);
	await session.refresh();
	assert.deepEqual(afterIds, [376, 500]);
	assert.deepEqual(session.state.readings.map((row) => row.id), [501]);
});

test('disposing aborts the request and prevents late updates', async () => {
	const pending = deferred();
	let signal;
	const { session, changes } = sessionMock(async (_afterId, nextSignal) => { signal = nextSignal; return pending.promise; });
	const running = session.refresh();
	session.dispose();
	const count = changes.length;
	assert.equal(signal.aborted, true);
	pending.resolve({ readings: [row(1)], throughId: 1 });
	await running;
	assert.equal(changes.length, count);
	await session.refresh(true);
	assert.equal(changes.length, count);
});
