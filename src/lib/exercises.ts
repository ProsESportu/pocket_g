import { addScatter, angleBetween, axisAngle, meanDirection, offAxisShare, principalAxis, type Rep, type RepSet, type Vec3 } from './reps.ts';

export const EXERCISE_STORAGE_KEY = 'pocket-g:exercises:v1';
// Engineering defaults. Recognition uses where the arm starts (gravity at the bottom of each rep) and the hinge it
// turns around, never range, so a short rep is still recognised and then flagged by the form checks.
export const EXERCISES = { minTeachReps: 3, minMatchReps: 2, matchDegrees: 35 } as const;
export const FORM = { shortRange: 0.8, fastLowering: 0.6, swingSpeed: 1.5, twistShare: 0.15 } as const;

export type ExerciseTemplate = {
	id: string; name: string; reps: number; createdAt: string;
	bottom: Vec3; top: Vec3; axis: Vec3;
	rangeDeg: number; upSeconds: number; downSeconds: number; peakSpeed: number; offAxisShare: number;
};
export type FormFlag = 'range' | 'lowering' | 'swing' | 'twist';
export type RepCheck = { rep: number; flags: FormFlag[]; rangeShortDeg: number };
export type SetAssessment = {
	set: number; status: 'waiting' | 'unknown' | 'matched';
	template: ExerciseTemplate | null; distanceDeg: number | null; checks: RepCheck[];
};
export const FLAG_LABEL: Record<FormFlag, string> = { range: 'Short range', lowering: 'Fast lowering', swing: 'Swing', twist: 'Twisting' };

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Shape of a group of reps: the average bottom and top directions and the dominant hinge. */
function shape(reps: readonly Rep[]) {
	const bottom = meanDirection(reps.map((rep) => rep.bottom)), top = meanDirection(reps.map((rep) => rep.top));
	const axis = principalAxis(reps.reduce<number[]>((sum, rep) => addScatter(sum, rep.scatter), [0, 0, 0, 0, 0, 0, 0, 0, 0]));
	return bottom && top && axis ? { bottom, top, axis } : null;
}

export function buildTemplate(name: string, reps: readonly Rep[], createdAt = new Date().toISOString()): ExerciseTemplate | string {
	const trimmed = name.trim();
	if (!trimmed) return 'Give the exercise a name.';
	if (reps.length < EXERCISES.minTeachReps) return `Only ${reps.length} rep${reps.length === 1 ? '' : 's'} detected — do at least ${EXERCISES.minTeachReps}.`;
	const found = shape(reps);
	if (!found) return 'These reps had no clear rotation. Try again with slower, fuller reps.';
	return {
		id: `${createdAt}-${trimmed}`, name: trimmed, reps: reps.length, createdAt, ...found,
		rangeDeg: median(reps.map((rep) => rep.rangeDeg)), upSeconds: median(reps.map((rep) => rep.upSeconds)),
		downSeconds: median(reps.map((rep) => rep.downSeconds)), peakSpeed: median(reps.map((rep) => rep.peakSpeed)),
		offAxisShare: median(reps.map((rep) => offAxisShare(rep.scatter, found.axis)))
	};
}

/** The worst of the two differences, so either a different start position or a different hinge rules a match out. */
export function exerciseDistance(reps: readonly Rep[], template: ExerciseTemplate): number | null {
	const found = shape(reps);
	return found ? Math.max(angleBetween(found.bottom, template.bottom), axisAngle(found.axis, template.axis)) : null;
}

export function checkRep(rep: Rep, template: ExerciseTemplate): RepCheck {
	const flags: FormFlag[] = [];
	if (rep.rangeDeg < FORM.shortRange * template.rangeDeg) flags.push('range');
	if (rep.downSeconds < FORM.fastLowering * template.downSeconds) flags.push('lowering');
	if (rep.atLimit || rep.peakSpeed > FORM.swingSpeed * template.peakSpeed) flags.push('swing');
	if (offAxisShare(rep.scatter, template.axis) > template.offAxisShare + FORM.twistShare) flags.push('twist');
	return { rep: rep.rep, flags, rangeShortDeg: Math.max(0, template.rangeDeg - rep.rangeDeg) };
}

export function assessSet(set: RepSet, templates: readonly ExerciseTemplate[]): SetAssessment {
	const empty = { set: set.set, template: null, distanceDeg: null, checks: [] };
	if (set.reps.length < EXERCISES.minMatchReps || !templates.length) return { ...empty, status: 'waiting' };
	let best: { template: ExerciseTemplate; distance: number } | null = null;
	for (const template of templates) {
		const distance = exerciseDistance(set.reps, template);
		if (distance !== null && (!best || distance < best.distance)) best = { template, distance };
	}
	if (!best || best.distance > EXERCISES.matchDegrees) return { ...empty, status: 'unknown', distanceDeg: best?.distance ?? null };
	const template = best.template;
	return { set: set.set, status: 'matched', template, distanceDeg: best.distance, checks: set.reps.map((rep) => checkRep(rep, template)) };
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isVec = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every(finite);

export function restoreExercises(saved: string | null): ExerciseTemplate[] {
	if (!saved) return [];
	try {
		const value = JSON.parse(saved);
		if (!value || value.version !== 1 || !Array.isArray(value.templates)) return [];
		return value.templates.filter((t: ExerciseTemplate) => t && typeof t.id === 'string' && typeof t.name === 'string' && t.name.trim() &&
			typeof t.createdAt === 'string' && Number.isSafeInteger(t.reps) && isVec(t.bottom) && isVec(t.top) && isVec(t.axis) &&
			[t.rangeDeg, t.upSeconds, t.downSeconds, t.peakSpeed, t.offAxisShare].every(finite));
	} catch { return []; }
}

export const serializeExercises = (templates: readonly ExerciseTemplate[]) => JSON.stringify({ version: 1, templates });
