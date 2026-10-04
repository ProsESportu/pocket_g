import { captureMilliseconds } from './capture-time.ts';

export type GyroReading = {
	id: number;
	created_at: string;
	gyro_x: number | null;
	gyro_y: number | null;
	gyro_z: number | null;
};
/** Gyro in rad/s after loading; the accelerometer stays in g (the MPU6050 default ±2 g range). */
export type ImuReading = GyroReading & { acc_x?: number | null; acc_y?: number | null; acc_z?: number | null };

export type GyroPivot = 'elbow' | 'shoulder';
export type GyroSettings = { massKg: number | null; pivot: GyroPivot; elbowCm: number; shoulderCm: number };
// The MPU6050 sends degrees per second (every axis clips at its default ±250 °/s range); the loader converts to rad/s.
export const GYRO = { smoothingSeconds: 0.25, restRadiansPerSecond: 0.05, maxGapSeconds: 2, setRestSeconds: 5, sensorUnits: 'deg/s', sensorLimitDegrees: 250 } as const;
export const DEGREES = Math.PI / 180;
export const GYRO_STORAGE_KEY = 'pocket-g:gyro-energy:v1';
export const defaultGyroSettings = (): GyroSettings => ({ massKg: null, pivot: 'elbow', elbowCm: 35, shoulderCm: 65 });
export const positiveFinite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
export const pivotDistanceCm = (settings: GyroSettings) => settings.pivot === 'elbow' ? settings.elbowCm : settings.shoulderCm;

/** Settings and the reset boundary are tab-local; samples are always reloaded from Supabase. */
export function restoreGyroSession(saved: string | null): { settings: GyroSettings; baselineId: number | null } {
	const fallback = { settings: defaultGyroSettings(), baselineId: null };
	if (!saved) return fallback;
	try {
		const value = JSON.parse(saved);
		if (!value || value.version !== 1) return fallback;
		const settings = value.settings;
		if (!settings || (settings.massKg !== null && !positiveFinite(settings.massKg)) ||
			!positiveFinite(settings.elbowCm) || !positiveFinite(settings.shoulderCm) ||
			(settings.pivot !== 'elbow' && settings.pivot !== 'shoulder') ||
			(value.baselineId !== null && (!Number.isSafeInteger(value.baselineId) || value.baselineId < 0))) return fallback;
		return { settings: { massKg: settings.massKg, pivot: settings.pivot, elbowCm: settings.elbowCm, shoulderCm: settings.shoulderCm }, baselineId: value.baselineId };
	} catch { return fallback; }
}

export function serializeGyroSession(settings: GyroSettings, baselineId: number | null): string {
	return JSON.stringify({ version: 1, settings, baselineId });
}

export type GyroEnergySet = {
	set: number; status: 'ongoing' | 'completed' | 'interrupted';
	workJ: number; durationSeconds: number;
	firstRecordId: number; lastRecordId: number; startedAt: string; endedAt: string;
};

export type GyroEnergy = {
	status: 'unset' | 'empty' | 'ready' | 'unavailable'; reason: string;
	workJ: number; latestKineticJ: number | null; sampleCount: number; skippedCount: number;
	segmentCount: number; durationSeconds: number;
	firstRecordId: number | null; lastRecordId: number | null; startedAt: string; endedAt: string;
	sets: GyroEnergySet[];
};

/** Positive changes in smoothed kinetic energy, rather than a sum or time integral of energy. */
export function estimateGyroEnergy(readings: readonly GyroReading[], settings: GyroSettings): GyroEnergy {
	const result: GyroEnergy = {
		status: 'empty', reason: 'No gyro readings in this session yet.', workJ: 0, latestKineticJ: null,
		sampleCount: 0, skippedCount: 0, segmentCount: 0, durationSeconds: 0,
		firstRecordId: null, lastRecordId: null, startedAt: '', endedAt: '', sets: []
	};
	const distance = pivotDistanceCm(settings) / 100;
	if (!positiveFinite(settings.massKg) || !positiveFinite(distance)) return { ...result, status: 'unset', reason: 'Enter a positive mass and movement distance to calculate energy.' };
	const factor = 0.5 * settings.massKg * distance * distance;
	if (!Number.isFinite(factor) || factor === 0) return { ...result, status: 'unavailable', reason: 'Mass or distance is outside the supported numerical range.' };
	let previous: { id: number; time: number; axes: number[]; kinetic: number } | null = null;
	let activeSet: GyroEnergySet | null = null;
	let setStartedSeconds = 0;
	let restStartedSeconds: number | null = null;
	function closeSet(status: 'completed' | 'interrupted') {
		if (activeSet) activeSet.status = status;
		activeSet = null;
		restStartedSeconds = null;
	}
	// Database order defines continuity; never reorder timestamps or interpolate missing readings.
	for (const row of readings) {
		const time = captureMilliseconds(row.created_at) / 1000;
		const raw = [row.gyro_x, row.gyro_y, row.gyro_z];
		result.latestKineticJ = null;
		if (!Number.isSafeInteger(row.id) || !Number.isFinite(time) || raw.some((axis) => typeof axis !== 'number' || !Number.isFinite(axis))) {
			result.skippedCount++;
			closeSet('interrupted');
			previous = null;
			continue;
		}
		const dt: number = previous ? time - previous.time : 0;
		const continuous: boolean = previous !== null && row.id === previous.id + 1 && dt > 0 && dt <= GYRO.maxGapSeconds;
		if (!continuous) closeSet('interrupted');
		const alpha: number = continuous ? -Math.expm1(-dt / GYRO.smoothingSeconds) : 1;
		const axes: number[] = (raw as number[]).map((axis, index): number => continuous ? previous!.axes[index] + alpha * (axis - previous!.axes[index]) : axis);
		const speed = Math.hypot(...axes);
		const kinetic = speed < GYRO.restRadiansPerSecond ? 0 : factor * speed * speed;
		if (!Number.isFinite(kinetic) || !Number.isFinite(result.workJ + kinetic)) {
			closeSet('interrupted');
			return { ...result, status: 'unavailable', latestKineticJ: null, reason: 'Gyro values exceed the supported numerical range.' };
		}
		const increment = continuous ? Math.max(0, kinetic - previous!.kinetic) : 0;
		if (continuous) {
			result.workJ += increment;
			result.durationSeconds += dt;
		} else result.segmentCount++;
		// Partition the same increments as the session total; set boundaries never reset smoothing.
		if (speed >= GYRO.restRadiansPerSecond) {
			if (!activeSet) {
				activeSet = { set: result.sets.length + 1, status: 'ongoing', workJ: 0, durationSeconds: 0,
					firstRecordId: row.id, lastRecordId: row.id, startedAt: row.created_at, endedAt: row.created_at };
				setStartedSeconds = time;
				result.sets.push(activeSet);
			}
			activeSet.workJ += increment;
			activeSet.lastRecordId = row.id;
			activeSet.endedAt = row.created_at;
			activeSet.durationSeconds = time - setStartedSeconds;
			restStartedSeconds = null;
		} else if (activeSet) {
			restStartedSeconds ??= time;
			if (time - restStartedSeconds >= GYRO.setRestSeconds) closeSet('completed');
		}
		if (result.firstRecordId === null) { result.firstRecordId = row.id; result.startedAt = row.created_at; }
		result.lastRecordId = row.id;
		result.endedAt = row.created_at;
		result.sampleCount++;
		result.latestKineticJ = kinetic;
		previous = { id: row.id, time, axes, kinetic };
	}
	if (!readings.length) return result;
	return { ...result, status: result.sampleCount ? 'ready' : 'unavailable', reason: result.sampleCount ? '' : 'No usable gyro samples with valid timestamps in this session.' };
}
