import type { Reading } from './readings.ts';
import { smooth } from './pulse.ts';

// Raw EMG swings across the sensor's range from one sample to the next, so the strip plots its envelope:
// the deviation from a 1 s moving mean, as RMS over a centered 0.25 s window. Higher means more muscle activity.
export const EMG_ACTIVITY = { meanSeconds: 1, rmsSeconds: 0.25, maxGapSeconds: 1 } as const;

/** Activity per record ID, computed within continuous runs; missing values and capture gaps start a new run. */
export function emgActivity(readings: Pick<Reading, 'id' | 'created_at' | 'emg'>[]): Map<number, number> {
	const rows = readings.filter((row) => Number.isFinite(Date.parse(row.created_at)))
		.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
	const origin = rows.length ? Date.parse(rows[0].created_at) : 0;
	const activity = new Map<number, number>();
	let run: { id: number; time: number; value: number }[] = [];
	const flush = () => {
		const values = run.map((sample) => sample.value), times = run.map((sample) => sample.time);
		const mean = smooth(values, times, EMG_ACTIVITY.meanSeconds / 2);
		const power = smooth(values.map((value, i) => (value - mean[i]) ** 2), times, EMG_ACTIVITY.rmsSeconds / 2);
		run.forEach((sample, i) => activity.set(sample.id, Math.sqrt(power[i])));
		run = [];
	};
	for (const row of rows) {
		const time = (Date.parse(row.created_at) - origin) / 1000;
		if (typeof row.emg !== 'number' || !Number.isFinite(row.emg)) { flush(); continue; }
		if (run.length && time - run.at(-1)!.time > EMG_ACTIVITY.maxGapSeconds) flush();
		run.push({ id: row.id, time, value: row.emg });
	}
	flush();
	return activity;
}
