import type { CoachNote } from './coach.ts';
import type { EcgResult } from './ecg.ts';
import type { Reading } from './readings.ts';

export const ECG_NOTE_THRESHOLD = 0.80;
export const NORMAL_ECG_LABELS = new Set(['NORMAL SINUS RHYTHM', 'NORMAL ECG', 'SINUS RHYTHM', 'otherwise normal ecg']);

export function ecgCoachNotes(result: EcgResult | null, readings: Reading[], stale = false): CoachNote[] {
	if (!result || result.status !== 'ready') return [];
	const window = result.window;
	const overlap = readings.filter((row) => window.firstRecordId !== null && window.lastRecordId !== null &&
		row.id >= window.firstRecordId && row.id <= window.lastRecordId).sort((a, b) => a.id - b.id);
	return result.scores.filter((row) => Number.isFinite(row.score) && row.score >= ECG_NOTE_THRESHOLD && !NORMAL_ECG_LABELS.has(row.label))
		.sort((a, b) => b.score - a.score || a.index - b.index).map((row) => ({
			id: `ecg-${row.index}`, kind: 'try', channel: 'ekg', from: window.startedAt, to: window.endedAt,
			...(overlap.length ? { fromId: overlap[0].id, toId: overlap.at(-1)!.id } : {}),
			text: `${stale ? 'Stale snapshot. ' : ''}ECG model output: ${row.label} — score ${(row.score * 100).toFixed(2)}%, records ${window.firstRecordId}–${window.lastRecordId}. Unvalidated at 125 Hz; requires clinical context. Labels may be fragments or comparison statements; no previous recording was compared by this app.`
		}));
}
