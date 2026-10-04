import type { CoachNote } from './coach.ts';
import type { EmgResult } from './emg.ts';
import type { Reading } from './readings.ts';

export function emgCoachNote(result: EmgResult | null, readings: Reading[], stale = false): CoachNote[] {
	if (!result || result.status !== 'ready' || result.triggerRep === null) return [];
	const window = result.window;
	const overlap = readings.filter((row) => window.firstRecordId !== null && window.lastRecordId !== null &&
		row.id >= window.firstRecordId && row.id <= window.lastRecordId).sort((a, b) => a.id - b.id);
	const newer = readings.some((row) => window.lastRecordId !== null && row.id > window.lastRecordId);
	return [{
		id: 'emg-fatigue', kind: 'try', channel: 'emg', from: window.startedAt, to: window.endedAt,
		...(overlap.length ? { fromId: overlap[0].id, toId: overlap.at(-1)!.id } : {}),
		text: `${stale ? 'Older result. ' : ''}EMG model flagged fatigue at rep ${result.triggerRep}. Experimental and unvalidated for this sensor.${newer ? ' Newer readings are in; press Analyze EMG again to update.' : ''}`
	}];
}
