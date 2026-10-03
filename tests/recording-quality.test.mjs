import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordingQuality, gyroRecordingQuality } from '../src/lib/recording-quality.ts';

const origin = Date.UTC(2026, 9, 4, 12);
const row = (id, milliseconds = (id - 1) * 10, overrides = {}) => ({ id, created_at: new Date(origin + milliseconds).toISOString(), ekg: 1, emg: 2, puls: 3, ...overrides });
const gyro = (id, milliseconds = (id - 1) * 100, overrides = {}) => ({ id, created_at: new Date(origin + milliseconds).toISOString(), gyro_x: 0, gyro_y: 0, gyro_z: 0, ...overrides });
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('reports finite coverage, observed capture timing and usable spans without changing input', () => {
	const rows = [row(3), row(2), row(1)], original = structuredClone(rows);
	const result = recordingQuality(rows);
	assert.deepEqual(rows, original);
	assert.equal(result.rowCount, 3);
	assert.equal(result.observedRateHz, 100);
	close(result.captureDurationSeconds, 0.02);
	assert.equal(result.startedAt, rows[2].created_at);
	assert.equal(result.endedAt, rows[0].created_at);
	for (const channel of result.channels) {
		assert.equal(channel.validCount, 3);
		assert.equal(channel.coveragePercent, 100);
		assert.equal(channel.missingRunCount, 0);
		close(channel.usableDurationSeconds, 0.02);
	}
});

test('counts isolated and ongoing missing runs without fabricating usable intervals', () => {
	const rows = [row(1), row(2, 10, { emg: null }), row(3), row(4, 30, { emg: NaN }), row(5, 40, { emg: Infinity })];
	const emg = recordingQuality(rows).channels.find((channel) => channel.key === 'emg');
	assert.equal(emg.validCount, 2);
	assert.equal(emg.coveragePercent, 40);
	assert.equal(emg.missingRunCount, 2);
	assert.equal(emg.longestMissingRun, 2);
	assert.equal(emg.usableDurationSeconds, 0);
});

test('includes malformed timestamps in coverage while making timing unavailable', () => {
	const result = recordingQuality([row(1), row(2, 10, { created_at: 'invalid' }), row(3)]);
	assert.equal(result.rowCount, 3);
	assert.equal(result.invalidTimestampCount, 1);
	assert.equal(result.observedRateHz, null);
	assert.equal(result.captureDurationSeconds, null);
	assert.equal(result.channels[0].validCount, 3);
	assert.equal(result.channels[0].usableDurationSeconds, 0);
});

test('sorts by ID rather than timestamp so repeated and backwards timing stays visible', () => {
	const result = recordingQuality([row(3, 0), row(1, 0), row(2, 0)]);
	assert.equal(result.nonIncreasingTimestampCount, 2);
	assert.equal(result.observedRateHz, null);
	assert.equal(result.captureDurationSeconds, null);
	assert.equal(result.channels[0].usableDurationSeconds, 0);
	const backwards = recordingQuality([row(1, 100), row(2, 0)]);
	assert.equal(backwards.nonIncreasingTimestampCount, 1);
});

test('counts absent IDs and pauses separately and excludes both from usable duration', () => {
	const result = recordingQuality([row(1, 0), row(2, 100), row(3, 200), row(4, 300), row(5, 400), row(8, 5000), row(9, 5100)]);
	assert.equal(result.recordGapCount, 1);
	assert.equal(result.missingIdCount, 2);
	assert.equal(result.pauseCount, 1);
	assert.equal(result.observedRateHz, 10);
	close(result.channels[0].usableDurationSeconds, 0.5);
	close(result.captureDurationSeconds, 5.1);
});

test('slow but regular acquisition is not a capture pause', () => {
	const result = recordingQuality([row(1, 0), row(2, 2000), row(3, 4000)]);
	assert.equal(result.pauseCount, 0);
	assert.equal(result.observedRateHz, 0.5);
	assert.equal(result.channels[0].usableDurationSeconds, 4);
});

test('empty and single-row windows do not fabricate coverage or sample rate', () => {
	const empty = recordingQuality([]);
	assert.equal(empty.rowCount, 0);
	assert.equal(empty.channels[0].coveragePercent, null);
	assert.equal(empty.observedRateHz, null);
	assert.equal(empty.captureDurationSeconds, null);
	const one = recordingQuality([row(1)]);
	assert.equal(one.channels[0].coveragePercent, 100);
	assert.equal(one.channels[0].usableDurationSeconds, 0);
	assert.equal(one.observedRateHz, null);
});

test('preserves Postgres sub-millisecond timestamps', () => {
	const result = recordingQuality([
		row(1, 0, { created_at: '2026-10-04T12:00:00.000100Z' }),
		row(2, 0, { created_at: '2026-10-04T12:00:00.000200Z' })
	]);
	assert.equal(result.nonIncreasingTimestampCount, 0);
	assert.ok(result.observedRateHz > 9000 && result.observedRateHz < 11000);
	assert.ok(result.channels[0].usableDurationSeconds > 0);
});

test('gyro quality is mass-independent and accepts stationary data while requiring all axes and time', () => {
	const result = gyroRecordingQuality([
		gyro(1), gyro(2), gyro(3, 200, { gyro_y: null }), gyro(4, 300, { created_at: 'invalid' }), gyro(5)
	]);
	assert.equal(result.channels.length, 1);
	assert.equal(result.channels[0].validCount, 3);
	assert.equal(result.channels[0].coveragePercent, 60);
	assert.equal(result.channels[0].longestMissingRun, 2);
	close(result.channels[0].usableDurationSeconds, 0.1);
	assert.equal(result.invalidTimestampCount, 1);
});

test('gyro uses the energy integration maximum gap of two seconds', () => {
	const result = gyroRecordingQuality([gyro(1, 0), gyro(2, 2000), gyro(3, 4001)]);
	assert.equal(result.pauseCount, 1);
	assert.equal(result.observedRateHz, 0.5);
	assert.equal(result.channels[0].usableDurationSeconds, 2);
});
