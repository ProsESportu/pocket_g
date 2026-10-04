import type { Reading } from './readings.ts';
import type { SensorField } from './chart.ts';
import { PULSE, type PulseResult } from './pulse.ts';

export type CoachKind = 'keep' | 'fix' | 'try';
export type CoachNote = {
	id: string; kind: CoachKind; text: string; channel?: SensorField;
	fromId?: number; toId?: number; from?: string; to?: string;
};

// A single missing value is usually transport jitter; three in a row is a sensor dropout.
export const MIN_DROPOUT = 3;
export const MIN_READINGS = 10;
const CHANNELS: SensorField[] = ['ekg', 'emg', 'puls'];
const NAME: Record<SensorField, string> = { ekg: 'ECG', emg: 'EMG', puls: 'pulse' };
const ORDER: Record<CoachKind, number> = { fix: 0, try: 1, keep: 2 };

const missing = (value: number | null) => value === null || !Number.isFinite(value);

function dropouts(rows: Reading[], channel: SensorField) {
	const runs: { from: number; to: number }[] = [];
	rows.forEach((row, index) => {
		if (!missing(row[channel])) return;
		const last = runs.at(-1);
		if (last && last.to === index - 1) last.to = index;
		else runs.push({ from: index, to: index });
	});
	return runs;
}

// Times always describe the span; record IDs only link a note to the strip when it covers part of the window.
function span(rows: Reading[], window: Reading[]): Pick<CoachNote, 'fromId' | 'toId' | 'from' | 'to'> {
	if (!rows.length) return {};
	const times = { from: rows[0].created_at, to: rows.at(-1)!.created_at };
	return rows.length < window.length ? { ...times, fromId: rows[0].id, toId: rows.at(-1)!.id } : times;
}

/** Signal-quality notes from the loaded readings. They describe the sensors, never the athlete's health. */
export function signalChecks(readings: Reading[], pulse: PulseResult): CoachNote[] {
	const rows = readings.filter((row) => Number.isFinite(Date.parse(row.created_at)))
		.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
	if (rows.length < MIN_READINGS) return [];
	const notes: CoachNote[] = [];
	let pulseOngoing = false;
	for (const channel of CHANNELS) {
		const runs = dropouts(rows, channel).filter((run) => run.to - run.from + 1 >= MIN_DROPOUT);
		if (!runs.length) continue;
		const last = runs.at(-1)!;
		const ongoing = last.to === rows.length - 1;
		const run = ongoing ? last : runs.reduce((best, item) => item.to - item.from > best.to - best.from ? item : best);
		const count = run.to - run.from + 1;
		if (channel === 'puls') pulseOngoing = ongoing;
		notes.push({
			id: `dropout-${channel}`, kind: 'fix', channel, ...span(rows.slice(run.from, run.to + 1), rows),
			text: ongoing
				? `No ${NAME[channel]} signal for the last ${count} readings. Check the ${NAME[channel]} sensor’s contact and cable.`
				: `The ${NAME[channel]} signal dropped out for ${count} readings. If it happens again, check that the sensor stays in contact while you move.`
		});
	}
	const pulseRows = rows.filter((row) => pulse.firstRecordId !== null && pulse.lastRecordId !== null && row.id >= pulse.firstRecordId && row.id <= pulse.lastRecordId);
	if (pulse.status === 'ready') {
		notes.push({ id: 'pulse-ready', kind: 'keep', channel: 'puls', ...span(pulseRows, rows), text: `The pulse sensor picks up clean beats: ${pulse.beatCount} clear beats in ${pulse.duration.toFixed(1)} seconds.` });
	} else if (pulse.status === 'unavailable' && pulse.duration >= PULSE.minSeconds && !pulseOngoing) {
		notes.push({ id: 'pulse-unclear', kind: 'try', channel: 'puls', ...span(pulseRows, rows), text: 'Pulse beats aren’t clear enough for a heart rate yet. Hold the pulse sensor still against the skin for a few seconds.' });
	}
	if (!notes.some((note) => note.kind === 'fix')) {
		const seconds = Math.round((Date.parse(rows.at(-1)!.created_at) - Date.parse(rows[0].created_at)) / 1000);
		notes.push({ id: 'sensors-connected', kind: 'keep', text: seconds >= 1 ? `No sensor dropped out in the last ${seconds} seconds.` : 'No sensor dropped out in the latest readings.' });
	}
	return notes.sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
}
