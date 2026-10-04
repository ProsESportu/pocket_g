import { captureMilliseconds } from './capture-time.ts';
import type { CoachNote } from './coach.ts';
import { EMG, type EmgReading } from './emg.ts';
import { emgActivity } from './emg-activity.ts';
import { repList } from './rep-coach.ts';
import type { RepSet } from './reps.ts';

// Electrode placement changes EMG amplitude, so each set is its own baseline: the median of its first three reps.
export const REP_EMG = { baselineReps: 3, lowPercent: 50, minCoverage: 0.8, marginSeconds: 1.5, traceHz: 25 } as const;

export type RepMuscle = { rep: number; activity: number | null; percent: number | null; low: boolean };
export type SetMuscle = {
	set: number; firstRecordId: number; offsetSeconds: number; reps: RepMuscle[]; covered: number;
	trace: { seconds: number; activity: number }[];
};

/** EMG time range for a set on the pulse board's clock (the motion clock minus the offset), with a margin. */
export function setEmgWindow(set: RepSet, offsetSeconds: number) {
	const reps = set.reps;
	const from = (reps.length ? reps[0].startMs : captureMilliseconds(set.startedAt)) - (offsetSeconds + REP_EMG.marginSeconds) * 1000;
	const to = (reps.length ? reps.at(-1)!.endMs : captureMilliseconds(set.endedAt)) - (offsetSeconds - REP_EMG.marginSeconds) * 1000;
	return { from, to };
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function muscleByRep(set: RepSet, emg: readonly EmgReading[], offsetSeconds: number): SetMuscle {
	const activity = emgActivity([...emg]);
	const samples = emg.flatMap((row) => {
		const value = activity.get(row.id), time = captureMilliseconds(row.created_at);
		// Moved onto the motion clock so samples line up with reps.
		return value === undefined || !Number.isFinite(time) ? [] : [{ ms: time + offsetSeconds * 1000, value }];
	}).sort((a, b) => a.ms - b.ms);
	const reps = set.reps.map((rep) => {
		const inside = samples.filter((sample) => sample.ms >= rep.startMs && sample.ms <= rep.endMs);
		const expected = Math.max(1, (rep.endMs - rep.startMs) / 1000 * EMG.sampleRate);
		const value = inside.length / expected >= REP_EMG.minCoverage ? inside.reduce((sum, sample) => sum + sample.value, 0) / inside.length : null;
		return { rep: rep.rep, activity: value, percent: null as number | null, low: false };
	});
	const baseline = reps.slice(0, REP_EMG.baselineReps).flatMap((rep) => rep.activity === null ? [] : [rep.activity]);
	const reference = baseline.length ? median(baseline) : 0;
	for (const rep of reps) {
		if (rep.activity === null || !(reference > 0)) continue;
		rep.percent = rep.activity / reference * 100;
		rep.low = rep.percent < REP_EMG.lowPercent;
	}
	const origin = captureMilliseconds(set.startedAt), step = 1000 / REP_EMG.traceHz;
	let next = -Infinity;
	const trace = samples.flatMap((sample) => {
		if (sample.ms < next) return [];
		next = sample.ms + step;
		return [{ seconds: (sample.ms - origin) / 1000, activity: sample.value }];
	});
	return { set: set.set, firstRecordId: set.firstRecordId, offsetSeconds, reps, covered: reps.filter((rep) => rep.activity !== null).length, trace };
}

/** EMG rows by ascending ID inside a time range on the pulse board's clock. */
export async function loadSetEmg(fetcher: typeof fetch, baseUrl: string, apiKey: string, fromMs: number, toMs: number, signal?: AbortSignal): Promise<EmgReading[]> {
	const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
	const rows: EmgReading[] = [];
	let cursor = 0;
	for (;;) {
		const url = new URL('/rest/v1/ekgemgpuls', baseUrl);
		url.search = new URLSearchParams({
			select: 'id,created_at,emg', order: 'id.asc', limit: '1000',
			and: `(created_at.gte.${new Date(fromMs).toISOString()},created_at.lte.${new Date(toMs).toISOString()},id.gt.${cursor})`
		}).toString();
		const response = await fetcher(url, { headers: { apikey: apiKey }, signal: requestSignal });
		if (!response.ok) throw new Error(`Could not load EMG for this set (HTTP ${response.status}).`);
		const page: EmgReading[] = await response.json();
		if (!Array.isArray(page) || page.length > 1000) throw new Error('The database returned an invalid EMG page.');
		for (const row of page) {
			if (!row || !Number.isSafeInteger(row.id) || row.id <= cursor) throw new Error('The database returned EMG samples out of order.');
			cursor = row.id;
			rows.push(row);
		}
		if (page.length < 1000) return rows;
	}
}

export function muscleCoachNotes(muscle: SetMuscle | null, sets: readonly RepSet[]): CoachNote[] {
	const set = muscle && sets.find((item) => item.firstRecordId === muscle.firstRecordId);
	if (!muscle || !set) return [];
	const times = { from: set.startedAt, to: set.endedAt };
	const low = muscle.reps.filter((rep) => rep.low);
	const notes: CoachNote[] = [];
	if (low.length) {
		const average = Math.round(low.reduce((sum, rep) => sum + rep.percent!, 0) / low.length);
		notes.push({ id: `muscle-${set.firstRecordId}`, kind: 'try', channel: 'emg', ...times,
			text: `Set ${set.set}: ${repList(low.map((rep) => rep.rep))} moved with about ${average}% of the muscle activity of reps 1–${Math.min(REP_EMG.baselineReps, muscle.reps.length)}.` });
	}
	if (muscle.covered > 0 && muscle.covered < muscle.reps.length) {
		notes.push({ id: `muscle-coverage-${set.firstRecordId}`, kind: 'try', channel: 'emg', ...times,
			text: `EMG was found for ${muscle.covered} of ${muscle.reps.length} reps in set ${set.set}. Check the EMG electrodes, or the motion clock offset if bursts don’t line up with the lifts.` });
	}
	return notes;
}
