import type { CoachNote } from './coach.ts';
import type { EmgResult } from './emg.ts';
import type { Reading } from './readings.ts';

export function emgCoachNote(result: EmgResult | null, readings: Reading[]): CoachNote[] {
	if (!result || result.status !== 'ready' || result.triggerRep === null) return [];
	const window = result.window;
	const overlap = readings.filter((row) => window.firstRecordId !== null && window.lastRecordId !== null &&
		row.id >= window.firstRecordId && row.id <= window.lastRecordId).sort((a, b) => a.id - b.id);
	const newer = readings.some((row) => window.lastRecordId !== null && row.id > window.lastRecordId);
	return [{
		id: 'emg-fatigue', kind: 'try', channel: 'emg', from: window.startedAt, to: window.endedAt,
		...(overlap.length ? { fromId: overlap[0].id, toId: overlap.at(-1)!.id } : {}),
		text: `Experimental EMG fatigue trigger at repetition ${result.triggerRep} in analyzed records ${window.firstRecordId}–${window.lastRecordId}. Scores are unvalidated at 125 Hz.${newer ? ' Newer readings have arrived; analyze again to update this snapshot.' : ''}`
	}];
}
