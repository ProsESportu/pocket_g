import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestGyroId, loadGyroSnapshot } from '../src/lib/gyro-readings.ts';

const rows = (count) => Array.from({ length: count }, (_, i) => ({ id: i + 1, created_at: new Date(1760000000000 + i * 250).toISOString(), gyro_x: 0, gyro_y: 180, gyro_z: 0 }));
// The sensor sends °/s; loaded rows carry rad/s.
const radians = (value) => typeof value === 'number' ? value * Math.PI / 180 : value;
const loaded = (input) => input.map((row) => ({ ...row, gyro_x: radians(row.gyro_x), gyro_y: radians(row.gyro_y), gyro_z: radians(row.gyro_z) }));
function databaseMock(input, cap = 1000, insertedAfterSnapshot = []) {
	const calls = [];
	let readings = [...input];
	const fetcher = async (input, options) => {
		const url = new URL(input);
		calls.push({ url, options });
		assert.equal(url.pathname, '/rest/v1/readings');
		assert.equal(options.headers.apikey, 'test-key');
		assert.equal(options.method ?? 'GET', 'GET');
		assert.equal(options.cache, 'no-store');
		if (url.searchParams.get('select') === 'id') {
			assert.equal(url.searchParams.get('order'), 'id.desc');
			assert.equal(url.searchParams.get('limit'), '1');
			const last = readings.at(-1);
			readings.push(...insertedAfterSnapshot);
			return Response.json(last ? [{ id: last.id }] : []);
		}
		assert.equal(url.searchParams.get('select'), 'id,created_at,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z');
		assert.equal(url.searchParams.get('order'), 'id.asc');
		const [, after, through] = url.searchParams.get('and').match(/^\(id.gt.(\d+),id.lte.(\d+)\)$/);
		return Response.json(readings.filter((row) => row.id > +after && row.id <= +through).slice(0, cap));
	};
	return { fetcher, calls };
}
const load = (fetcher, afterId = 0, signal) => loadGyroSnapshot(fetcher, 'https://example.supabase.co', 'test-key', afterId, signal);

test('loads all history with ascending keyset pagination across smaller API caps', async () => {
	const input = rows(2301);
	const { fetcher, calls } = databaseMock(input, 200);
	assert.deepEqual(await load(fetcher), { readings: loaded(input), throughId: 2301 });
	assert.equal(calls.length, 13);
	assert.equal(calls[1].url.searchParams.get('and'), '(id.gt.0,id.lte.2301)');
	assert.equal(calls[2].url.searchParams.get('and'), '(id.gt.200,id.lte.2301)');
	assert.ok(calls.every((call) => call.options.signal instanceof AbortSignal));
});

test('concurrent inserts stay outside the fixed snapshot; later loads fetch only new rows', async () => {
	const input = rows(1500);
	const newer = rows(1600).slice(1500);
	const { fetcher } = databaseMock(input, 1000, newer);
	assert.deepEqual(await load(fetcher), { readings: loaded(input), throughId: 1500 });
	const next = databaseMock([...input, ...newer]);
	assert.deepEqual(await load(next.fetcher, 1500), { readings: loaded(newer), throughId: 1600 });
	assert.equal(next.calls[1].url.searchParams.get('and'), '(id.gt.1500,id.lte.1600)');
});

test('empty/unchanged tables produce no new rows; replacement requires an explicit session reset', async () => {
	assert.deepEqual(await load(databaseMock([]).fetcher), { readings: [], throughId: 0 });
	const unchanged = databaseMock(rows(5));
	assert.deepEqual(await load(unchanged.fetcher, 5), { readings: [], throughId: 5 });
	assert.equal(unchanged.calls.length, 1);
	await assert.rejects(load(databaseMock(rows(4)).fetcher, 5), /cleared or replaced/);
});

test('null gyro readings remain in the snapshot so the calculator can break segments', async () => {
	const input = rows(10);
	input[5].gyro_y = null;
	assert.deepEqual((await load(databaseMock(input).fetcher)).readings, loaded(input));
	assert.equal((await load(databaseMock(input).fetcher)).readings[5].gyro_y, null);
});

test('converts the MPU6050 degrees per second to radians per second', async () => {
	const [row] = (await load(databaseMock([{ ...rows(1)[0], gyro_x: -90, gyro_y: 180, gyro_z: 250 }]).fetcher)).readings;
	assert.equal(row.gyro_x, -Math.PI / 2);
	assert.equal(row.gyro_y, Math.PI);
	assert.ok(Math.abs(row.gyro_z - 4.3633) < 1e-4);
});

test('rejects failed/malformed pages, bad boundaries and out-of-order or unbounded rows', async () => {
	await assert.rejects(load(async () => new Response('', { status: 403 })), /HTTP 403/);
	await assert.rejects(load(async () => Response.json({})), /invalid gyro page/);
	await assert.rejects(load(async () => Response.json([{ id: '1' }])), /invalid gyro record ID/);
	await assert.rejects(load(databaseMock([]).fetcher, -1), /Invalid gyro session boundary/);
	for (const page of [[...rows(2)].reverse(), [rows(2)[0], rows(2)[0]], [{ ...rows(2)[0], id: 3 }], rows(1001)]) {
		let call = 0;
		await assert.rejects(load(async () => Response.json(call++ === 0 ? [{ id: 2 }] : page)), /out of order|invalid gyro page/);
	}
});

test('aborted requests do not publish partial snapshots', async () => {
	const aborter = new AbortController();
	const mock = databaseMock(rows(1500));
	let count = 0;
	const fetcher = async (...args) => {
		const response = await mock.fetcher(...args);
		if (++count === 2) aborter.abort();
		return response;
	};
	await assert.rejects(load(fetcher, 0, aborter.signal), { name: 'AbortError' });
	assert.equal(mock.calls.length, 2);
});

test('reset-boundary lookup is read-only and returns zero when the table is empty', async () => {
	assert.equal(await latestGyroId(databaseMock(rows(376)).fetcher, 'https://example.supabase.co', 'test-key'), 376);
	assert.equal(await latestGyroId(databaseMock([]).fetcher, 'https://example.supabase.co', 'test-key'), 0);
});
