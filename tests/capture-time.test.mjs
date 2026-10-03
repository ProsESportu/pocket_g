import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureMilliseconds } from '../src/lib/capture-time.ts';

test('retains Postgres microseconds and existing millisecond timestamps', () => {
	const base = '2026-10-04T10:00:00.123';
	assert.equal(captureMilliseconds(`${base}Z`), Date.parse(`${base}Z`));
	assert.equal(captureMilliseconds(`${base}456Z`), Date.parse(`${base}Z`) + 0.456);
	assert.ok(captureMilliseconds(`${base}457Z`) > captureMilliseconds(`${base}456Z`));
});

test('supports timezone offsets while preserving their fractional capture time', () => {
	const utc = captureMilliseconds('2026-10-04T10:00:00.123456Z');
	assert.equal(captureMilliseconds('2026-10-04T12:00:00.123456+02:00'), utc);
	assert.equal(captureMilliseconds('2026-10-04T12:00:00.123456+0200'), utc);
});

test('rejects missing, malformed and non-string capture times', () => {
	for (const value of [undefined, null, '', 'invalid', 1720000000000, {}]) {
		assert.ok(Number.isNaN(captureMilliseconds(value)));
	}
});
