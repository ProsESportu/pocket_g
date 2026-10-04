import { captureMilliseconds } from './capture-time.ts';
import { DEGREES, estimateGyroEnergy, GYRO, type GyroEnergySet, type GyroSettings, type ImuReading } from './gyro-energy.ts';
import { pulsePeaks, smooth } from './pulse.ts';

export type Vec3 = [number, number, number];

// Engineering defaults for a forearm-worn MPU6050 sampled at about 5 Hz.
export const REPS = {
	accSmoothingSeconds: 0.4, // centered window for the gravity direction
	restContextSeconds: 1, // rest before a set that defines its starting direction
	tailSeconds: 1.5, // samples after the last active one, so the final lowering stays in the set
	minRangeDegrees: 30, // a top must rise and fall this far to count as a rep
	minRepSeconds: 0.8, // tops closer together than this are one rep
	phaseFraction: 0.05 // lifting starts, and lowering ends, within 5% of the range from the bottom
} as const;

export type Rep = {
	rep: number; rangeDeg: number; upSeconds: number; downSeconds: number;
	peakSpeed: number; atLimit: boolean; // while lifting: rad/s, and whether any axis reached the ±250 °/s sensor limit
	topSeconds: number; topDeg: number; startMs: number; endMs: number; firstRecordId: number; lastRecordId: number;
	bottom: Vec3; top: Vec3; scatter: number[]; // gravity directions and Σωωᵀ (row-major 3×3) for recognition
};
export type RepSet = {
	set: number; status: GyroEnergySet['status']; firstRecordId: number; lastRecordId: number;
	startedAt: string; endedAt: string; durationSeconds: number;
	reps: Rep[]; trace: { seconds: number; deg: number }[];
};

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function normalize(v: Vec3): Vec3 | null {
	const length = Math.hypot(...v);
	return length > 1e-9 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : null;
}
export const angleBetween = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / DEGREES;
/** Rotation axes have no preferred sign, so opposite axes count as the same. */
export const axisAngle = (a: Vec3, b: Vec3) => Math.min(angleBetween(a, b), 180 - angleBetween(a, b));
/** The average of unit vectors, as a direction. */
export function meanDirection(vectors: readonly Vec3[]): Vec3 | null {
	return normalize(vectors.reduce<Vec3>((sum, v) => [sum[0] + v[0], sum[1] + v[1], sum[2] + v[2]], [0, 0, 0]));
}
export const addScatter = (a: readonly number[], b: readonly number[]) => a.map((value, i) => value + b[i]);
/** Dominant rotation axis of a 3×3 scatter matrix, by power iteration. */
export function principalAxis(scatter: readonly number[]): Vec3 | null {
	let axis: Vec3 | null = [1, 1, 1];
	for (let i = 0; i < 64 && axis; i++) {
		const [x, y, z]: Vec3 = axis;
		axis = normalize([
			scatter[0] * x + scatter[1] * y + scatter[2] * z,
			scatter[3] * x + scatter[4] * y + scatter[5] * z,
			scatter[6] * x + scatter[7] * y + scatter[8] * z
		]);
	}
	return axis;
}
/** Share of rotation that is not around `axis`: 0 means a clean hinge, 1 means none of it was. */
export function offAxisShare(scatter: readonly number[], axis: Vec3): number {
	const total = scatter[0] + scatter[4] + scatter[8];
	if (!(total > 0)) return 0;
	const [x, y, z] = axis;
	const along = x * (scatter[0] * x + scatter[1] * y + scatter[2] * z) + y * (scatter[3] * x + scatter[4] * y + scatter[5] * z) + z * (scatter[6] * x + scatter[7] * y + scatter[8] * z);
	return Math.max(0, Math.min(1, 1 - along / total));
}

// Set boundaries don't depend on mass or distance, so the energy panel's detection is reused as-is and the
// set numbers here always match "Energy by detected set".
const SET_ONLY: GyroSettings = { massKg: 1, pivot: 'elbow', elbowCm: 100, shoulderCm: 100 };
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const usable = (row: ImuReading) => [row.acc_x, row.acc_y, row.acc_z, row.gyro_x, row.gyro_y, row.gyro_z].every(finite) && Number.isFinite(captureMilliseconds(row.created_at));
const limit = (GYRO.sensorLimitDegrees - 5) * DEGREES;

export function analyzeReps(readings: readonly ImuReading[]): RepSet[] {
	const sets = estimateGyroEnergy(readings, SET_ONLY).sets;
	const index = new Map(readings.map((row, i) => [row.id, i]));
	const time = (i: number) => captureMilliseconds(readings[i].created_at) / 1000;
	const joined = (i: number) => i > 0 && readings[i].id === readings[i - 1].id + 1 && time(i) - time(i - 1) > 0 && time(i) - time(i - 1) <= GYRO.maxGapSeconds;
	return sets.map((set, n) => {
		const first = index.get(set.firstRecordId)!, last = index.get(set.lastRecordId)!;
		const nextFirst = n + 1 < sets.length ? index.get(sets[n + 1].firstRecordId)! : readings.length;
		let start = first, end = last;
		while (start > 0 && joined(start) && time(first) - time(start - 1) <= REPS.restContextSeconds) start--;
		// An ongoing set keeps every later sample; a finished one keeps its final lowering.
		while (end + 1 < nextFirst && joined(end + 1) && (set.status === 'ongoing' || time(end + 1) - time(last) <= REPS.tailSeconds)) end++;
		const rows = readings.slice(start, end + 1).filter(usable);
		const result: RepSet = { set: set.set, status: set.status, firstRecordId: set.firstRecordId, lastRecordId: set.lastRecordId,
			startedAt: set.startedAt, endedAt: set.endedAt, durationSeconds: set.durationSeconds, reps: [], trace: [] };
		if (rows.length < 3) return result;
		const ms = rows.map((row) => captureMilliseconds(row.created_at));
		const times = ms.map((value) => (value - captureMilliseconds(set.startedAt)) / 1000);
		const axes = (['acc_x', 'acc_y', 'acc_z'] as const).map((key) => smooth(rows.map((row) => row[key]!), times, REPS.accSmoothingSeconds / 2));
		const gravity = rows.map((_, i) => normalize([axes[0][i], axes[1][i], axes[2][i]]));
		// The starting direction is the rest just before the set (arm hanging), or the first sample of the set.
		const before = gravity.filter((g, i): g is Vec3 => g !== null && rows[i].id < set.firstRecordId);
		const reference = meanDirection(before) ?? gravity.find((g) => g !== null);
		if (!reference) return result;
		const samples = rows.flatMap((row, i) => gravity[i] ? [{ row, ms: ms[i], seconds: times[i], g: gravity[i]!, deg: angleBetween(gravity[i]!, reference) }] : []);
		result.trace = samples.map(({ seconds, deg }) => ({ seconds, deg }));
		const deg = samples.map((sample) => sample.deg), at = samples.map((sample) => sample.seconds);
		const tops = pulsePeaks(deg, REPS.minRangeDegrees, REPS.minRepSeconds, at).map(Math.round);
		const lowest = (from: number, to: number) => {
			let best = from;
			for (let i = from; i <= to; i++) if (deg[i] < deg[best]) best = i;
			return best;
		};
		// Crossing time of `level` between samples a and b, interpolated so 5 Hz timing isn't stuck on 0.2 s steps.
		const cross = (a: number, b: number, level: number) => deg[a] === deg[b] ? at[a] : at[a] + (at[b] - at[a]) * (level - deg[a]) / (deg[b] - deg[a]);
		result.reps = tops.flatMap((top, r) => {
			const low = lowest(r ? tops[r - 1] + 1 : 0, top - 1), high = lowest(top + 1, r + 1 < tops.length ? tops[r + 1] - 1 : deg.length - 1);
			if (low >= top || high <= top || high >= deg.length) return [];
			const liftLevel = deg[low] + REPS.phaseFraction * (deg[top] - deg[low]);
			const lowerLevel = deg[high] + REPS.phaseFraction * (deg[top] - deg[high]);
			let q = top;
			while (q > low && deg[q] > liftLevel) q--;
			const lift = q < top ? cross(q, q + 1, liftLevel) : at[top];
			q = top;
			while (q < high && deg[q] > lowerLevel) q++;
			const lower = q > top ? cross(q - 1, q, lowerLevel) : at[top];
			let peakSpeed = 0, atLimit = false, scatter = [0, 0, 0, 0, 0, 0, 0, 0, 0];
			for (let i = low; i <= high; i++) {
				const w: Vec3 = [samples[i].row.gyro_x!, samples[i].row.gyro_y!, samples[i].row.gyro_z!];
				// Speed is judged on the way up, where swinging happens; a dropped weight is a lowering problem.
				if (i <= top) {
					peakSpeed = Math.max(peakSpeed, Math.hypot(...w));
					atLimit ||= w.some((axis) => Math.abs(axis) >= limit);
				}
				scatter = addScatter(scatter, [w[0] * w[0], w[0] * w[1], w[0] * w[2], w[1] * w[0], w[1] * w[1], w[1] * w[2], w[2] * w[0], w[2] * w[1], w[2] * w[2]]);
			}
			const origin = captureMilliseconds(set.startedAt);
			return [{
				rep: 0, rangeDeg: angleBetween(samples[low].g, samples[top].g), upSeconds: at[top] - lift, downSeconds: lower - at[top],
				peakSpeed, atLimit, topSeconds: at[top], topDeg: deg[top], startMs: origin + lift * 1000, endMs: origin + lower * 1000,
				firstRecordId: samples[low].row.id, lastRecordId: samples[high].row.id,
				bottom: samples[low].g, top: samples[top].g, scatter
			}];
		}).map((rep, i) => ({ ...rep, rep: i + 1 }));
		return result;
	});
}

/** The newest set with counted reps; a newer set takes over once its first rep is counted. */
export function displayedSet(sets: readonly RepSet[]): RepSet | null {
	return sets.findLast((set) => set.reps.length > 0) ?? null;
}
