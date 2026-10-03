import type { EmgPrediction } from './emg.ts';

export type RepInterval = {
	fromRep: number;
	toRep: number;
	seconds: number;
	medianDeviationPercent: number;
};
export type RepConsistency =
	| { status: 'unavailable'; reason: string }
	| { status: 'ready'; intervals: RepInterval[]; medianSeconds: number; variationPercent: number };

/** Peak times are already in seconds relative to the completed EMG window. */
export function repConsistency(rows: readonly Pick<EmgPrediction, 'rep' | 'peak_time'>[]): RepConsistency {
	if (rows.length < 3) {
		return { status: 'unavailable', reason: 'At least three detected repetitions are needed to compare timing.' };
	}
	const durations: number[] = [];
	for (let index = 0; index < rows.length; index++) {
		const peak = rows[index].peak_time;
		if (!Number.isFinite(peak) || (index > 0 && peak <= rows[index - 1].peak_time)) {
			return { status: 'unavailable', reason: 'Detected peak times must be finite and strictly increasing to compare timing.' };
		}
		if (index > 0) {
			const seconds = peak - rows[index - 1].peak_time;
			if (!Number.isFinite(seconds)) {
				return { status: 'unavailable', reason: 'Detected peak intervals cannot be measured from this snapshot.' };
			}
			durations.push(seconds);
		}
	}
	const sorted = [...durations].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const medianSeconds = sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
	// Normalize before summing/squaring to keep statistics finite for large intervals.
	const maximum = sorted.at(-1)!;
	const normalized = durations.map((seconds) => seconds / maximum);
	const mean = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
	const variance = normalized.reduce((sum, value) => sum + (value - mean) ** 2, 0) / normalized.length;
	return {
		status: 'ready', medianSeconds, variationPercent: Math.sqrt(variance) / mean * 100,
		intervals: durations.map((seconds, index) => ({
			fromRep: rows[index].rep, toRep: rows[index + 1].rep, seconds,
			medianDeviationPercent: (seconds / medianSeconds - 1) * 100
		}))
	};
}
