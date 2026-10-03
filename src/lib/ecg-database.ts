import { ECG_SAMPLES } from './ecg.ts';
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
};

export function databaseEcgWindow(readings: EcgReading[]): EcgWindow {
	// Select the newest records first, including missing values; only then put the waveform in time order.
	const ordered = [...readings].sort((a, b) => b.id - a.id).slice(0, ECG_SAMPLES).reverse();
	const values = ordered.map((row) => row.ekg);
	const available = values.filter((value) => typeof value === 'number' && Number.isFinite(value) && Number.isFinite(Math.fround(value))).length;
	return {
		// Never pad an incomplete window or pass invalid values to the model.
		samples: available === ECG_SAMPLES ? values as number[] : [],
		available,
		rowCount: ordered.length,
		firstRecordId: ordered[0]?.id ?? null,
		lastRecordId: ordered.at(-1)?.id ?? null,
		startedAt: ordered[0]?.created_at ?? '',
		endedAt: ordered.at(-1)?.created_at ?? '',
		error: ''
	};
}
