import type { CoachNote } from './coach.ts';
import type { FormFlag, SetAssessment } from './exercises.ts';
import type { RepSet } from './reps.ts';

/** [6, 7, 8] → "reps 6–8"; [2, 5, 7] → "reps 2, 5 and 7". */
export function repList(reps: readonly number[]): string {
	const runs: [number, number][] = [];
	for (const rep of [...reps].sort((a, b) => a - b)) {
		const last = runs.at(-1);
		if (last && rep === last[1] + 1) last[1] = rep; else runs.push([rep, rep]);
	}
	const parts = runs.map(([from, to]) => from === to ? `${from}` : `${from}–${to}`);
	const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
	return `${reps.length === 1 ? 'rep' : 'reps'} ${joined}`;
}

const PHRASE: Record<Exclude<FormFlag, 'range'>, [string, string]> = {
	lowering: ['was lowered faster', 'were lowered faster'],
	swing: ['was swung up faster', 'were swung up faster'],
	twist: ['twisted more', 'twisted more']
};

/**
 * One note per recognised set: what differed from the taught example, or a keep note when the newest finished set
 * matched it on every rep. Motion record IDs aren't strip IDs, so notes carry times only.
 */
export function formCoachNotes(sets: readonly RepSet[], assessments: readonly SetAssessment[], limit = 3): CoachNote[] {
	const notes: CoachNote[] = [];
	const finished = sets.findLast((set) => set.status !== 'ongoing' && set.reps.length > 0);
	for (const assessment of [...assessments].reverse()) {
		const set = sets.find((item) => item.set === assessment.set);
		if (!set || assessment.status !== 'matched' || notes.length >= limit) continue;
		const name = assessment.template!.name;
		const flagged = (flag: FormFlag) => assessment.checks.filter((check) => check.flags.includes(flag));
		const parts: string[] = [];
		const short = flagged('range');
		if (short.length) parts.push(`${repList(short.map((check) => check.rep))} had about ${Math.round(short.reduce((sum, check) => sum + check.rangeShortDeg, 0) / short.length)}° less range`);
		for (const flag of ['lowering', 'swing', 'twist'] as const) {
			const reps = flagged(flag);
			if (reps.length) parts.push(`${repList(reps.map((check) => check.rep))} ${PHRASE[flag][reps.length === 1 ? 0 : 1]}`);
		}
		const times = { from: set.startedAt, to: set.endedAt };
		if (parts.length) notes.push({ id: `form-${set.firstRecordId}`, kind: 'try', ...times, text: `Set ${set.set} compared with your taught ${name}: ${parts.join('; ')}.` });
		else if (set === finished && set.reps.length >= 3) notes.push({ id: `form-${set.firstRecordId}`, kind: 'keep', ...times, text: `Set ${set.set}: all ${set.reps.length} reps matched your taught ${name}.` });
	}
	return notes;
}
