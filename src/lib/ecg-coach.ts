import type { CoachNote } from './coach.ts';
import { NORMAL_ECG_LABELS, type EcgResult } from './ecg.ts';
import type { Reading } from './readings.ts';

export const ECG_NOTE_THRESHOLD = 0.80;

export function ecgCoachNotes(result: EcgResult | null, readings: Reading[], stale = false): CoachNote[] {
	if (!result || result.status !== 'ready') return [];
	const window = result.window;
	const overlap = readings.filter((row) => window.firstRecordId !== null && window.lastRecordId !== null &&
		row.id >= window.firstRecordId && row.id <= window.lastRecordId).sort((a, b) => a.id - b.id);
	return result.scores.filter((row) => Number.isFinite(row.score) && row.score >= ECG_NOTE_THRESHOLD && !NORMAL_ECG_LABELS.has(row.label))
		.sort((a, b) => b.score - a.score || a.index - b.index).map((row) => ({
			id: `ecg-${row.index}`, kind: 'try', channel: 'ekg', from: window.startedAt, to: window.endedAt,
			...(overlap.length ? { fromId: overlap[0].id, toId: overlap.at(-1)!.id } : {}),
			text: `${stale ? 'Older result. ' : ''}ECG model flagged “${row.label}” at ${(row.score * 100).toFixed(2)}%. Experimental and not a diagnosis. Labels can be fragments, and no earlier recording was compared.`
		}));
}
