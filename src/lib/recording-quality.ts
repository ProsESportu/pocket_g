import { captureMilliseconds } from './capture-time.ts';
import type { Reading } from './readings.ts';
import { GYRO, type GyroReading } from './gyro-energy.ts';

export type ChannelQuality = {
	key: string; name: string; validCount: number; coveragePercent: number | null;
	missingRunCount: number; longestMissingRun: number; usableDurationSeconds: number;
};
export type RecordingQualitySummary = {
	rowCount: number; channels: ChannelQuality[]; invalidTimestampCount: number;
	nonIncreasingTimestampCount: number; invalidIdCount: number; recordGapCount: number;
	missingIdCount: number; pauseCount: number; observedRateHz: number | null;
	captureDurationSeconds: number | null; startedAt: string; endedAt: string;
};
type TimedRow = { id: number; created_at: string };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize<T extends TimedRow>(input: readonly T[], channels: { key: string; name: string; valid: (row: T) => boolean }[], maxGapSeconds?: number): RecordingQualitySummary {
	// IDs describe capture order. Sorting by timestamp would conceal backwards capture times.
	const rows = [...input].sort((a, b) => a.id - b.id);
	const times = rows.map((row) => captureMilliseconds(row.created_at));
	const validId = (id: number) => Number.isSafeInteger(id) && id > 0;
	const typicalIntervals = times.slice(1).flatMap((time, index) => {
		const previous = times[index], dt = (time - previous) / 1000;
		return validId(rows[index].id) && rows[index + 1].id === rows[index].id + 1 && finite(dt) && dt > 0 ? [dt] : [];
	});
	const gapLimit = maxGapSeconds ?? Math.max(1, typicalIntervals.length ? median(typicalIntervals) * 5 : 1);
	const result: RecordingQualitySummary = {
		rowCount: rows.length, channels: [], invalidTimestampCount: times.filter((time) => !finite(time)).length,
		nonIncreasingTimestampCount: 0, invalidIdCount: rows.filter((row) => !validId(row.id)).length,
		recordGapCount: 0, missingIdCount: 0, pauseCount: 0, observedRateHz: null,
		captureDurationSeconds: null, startedAt: '', endedAt: ''
	};
	const continuous = rows.map(() => false), usableIntervals: number[] = [];
	for (let index = 1; index < rows.length; index++) {
		const previous = rows[index - 1], row = rows[index], dt = (times[index] - times[index - 1]) / 1000;
		const idsValid = validId(previous.id) && validId(row.id);
		if (idsValid && row.id > previous.id + 1) { result.recordGapCount++; result.missingIdCount += row.id - previous.id - 1; }
		if (finite(dt) && dt <= 0) result.nonIncreasingTimestampCount++;
		if (finite(dt) && dt > gapLimit) result.pauseCount++;
		continuous[index] = idsValid && row.id === previous.id + 1 && finite(dt) && dt > 0 && dt <= gapLimit;
		if (continuous[index]) usableIntervals.push(dt);
	}
	if (usableIntervals.length && !result.invalidTimestampCount && !result.nonIncreasingTimestampCount) result.observedRateHz = 1 / median(usableIntervals);
	const first = times.findIndex(finite), last = times.findLastIndex(finite);
	if (first >= 0) {
		result.startedAt = rows[first].created_at; result.endedAt = rows[last].created_at;
		if (!result.invalidTimestampCount && !result.nonIncreasingTimestampCount) result.captureDurationSeconds = (times[last] - times[first]) / 1000;
	}
	result.channels = channels.map((channel) => {
		const valid = rows.map((row) => channel.valid(row));
		let missingRunCount = 0, longestMissingRun = 0, run = 0, usableDurationSeconds = 0;
		valid.forEach((present, index) => {
			if (present) run = 0;
			else { if (!run) missingRunCount++; run++; longestMissingRun = Math.max(longestMissingRun, run); }
			if (index && present && valid[index - 1] && continuous[index]) usableDurationSeconds += (times[index] - times[index - 1]) / 1000;
		});
		const validCount = valid.filter(Boolean).length;
		return { key: channel.key, name: channel.name, validCount, coveragePercent: rows.length ? validCount / rows.length * 100 : null, missingRunCount, longestMissingRun, usableDurationSeconds };
	});
	return result;
}

/** Coverage is relative to fetched rows, not an estimate of all sensor packets produced. */
export function recordingQuality(readings: readonly Reading[]): RecordingQualitySummary {
	return summarize(readings, [
		{ key: 'ekg', name: 'ECG', valid: (row) => finite(row.ekg) },
		{ key: 'emg', name: 'EMG', valid: (row) => finite(row.emg) },
		{ key: 'puls', name: 'Pulse', valid: (row) => finite(row.puls) }
	]);
}

/** Gyro eligibility is independent of mass and pivot settings. Stationary samples remain valid. */
export function gyroRecordingQuality(readings: readonly GyroReading[]): RecordingQualitySummary {
	return summarize(readings, [{ key: 'gyro', name: 'Motion', valid: (row) =>
		finite(row.gyro_x) && finite(row.gyro_y) && finite(row.gyro_z) && finite(captureMilliseconds(row.created_at))
	}], GYRO.maxGapSeconds);
}
