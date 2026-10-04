import { ECG_SAMPLES, ECG_SAMPLE_RATE } from './ecg.ts';
import { captureMilliseconds } from './capture-time.ts';
import { continuousCapture, expectedCaptureRate } from './signal-timing.ts';
import type { Reading } from './readings.ts';

export type EcgReading = Pick<Reading, 'id' | 'created_at' | 'ekg'>;
export type EcgWindow = {
	samples: number[];
	available: number;
	rowCount: number;
	firstRecordId: number | null;
	lastRecordId: number | null;
	startedAt: string;
	endedAt: string;
	error: string;
	reason: string;
};

export function databaseEcgWindow(readings: EcgReading[]): EcgWindow {
	// Select the newest records first, including missing values; only then put the waveform in time order.
	const ordered = [...readings].sort((a, b) => b.id - a.id).slice(0, ECG_SAMPLES).reverse();
	const values = ordered.map((row) => row.ekg);
	const available = values.filter((value) => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value))).length;
	const timingValid = ordered.every((row, i) => Number.isFinite(captureMilliseconds(row.created_at)) &&
		(i === 0 || continuousCapture(ordered[i - 1], row, ECG_SAMPLE_RATE))) && expectedCaptureRate(ordered, ECG_SAMPLE_RATE);
	const reason = ordered.length === ECG_SAMPLES && !timingValid
		? `ECG needs a continuous ${ECG_SAMPLE_RATE.toLocaleString('en-GB')} Hz recording. Capture timing or record gaps do not match; wait for 10 seconds of new data.` : '';
	return {
		// Never pad an incomplete window or pass invalid values to the model.
		samples: available === ECG_SAMPLES && timingValid ? values as number[] : [],
		available,
		rowCount: ordered.length,
		firstRecordId: ordered[0]?.id ?? null,
		lastRecordId: ordered.at(-1)?.id ?? null,
		startedAt: ordered[0]?.created_at ?? '',
		endedAt: ordered.at(-1)?.created_at ?? '',
		error: '', reason
	};
}
