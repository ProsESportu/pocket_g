import type * as Ort from 'onnxruntime-web';
import type { InferenceSession } from 'onnxruntime-web';
import { EMG, EMG_FEATURES, type EmgFeatures, type EmgMetadata, type EmgPrediction, type EmgProfile } from './emg.ts';

export function validateMetadata(value: unknown): EmgMetadata {
	const meta = value as EmgMetadata;
	if (!meta || meta.schema_version !== 1 || !Array.isArray(meta.feature_cols) ||
		meta.feature_cols.join(',') !== EMG_FEATURES.join(',') || meta.input_name !== 'features' ||
		meta.output_name !== 'fatigue_probability' || !/^[a-f0-9]{64}$/.test(meta.model_sha256)) {
		throw new Error('Unsupported EMG model metadata or feature order.');
	}
	if (meta.best_threshold !== 0.58 || meta.trigger_M !== 2 || meta.trigger_N !== 3 || meta.smooth_alpha !== null) {
		throw new Error('The EMG model threshold and trigger must match the supplied export.');
	}
	return meta;
}

export function validateProfile(value: unknown): EmgProfile {
	const profile = value as EmgProfile;
	const p = profile?.preprocessing;
	if (!profile || profile.id !== EMG.profile || profile.experimental !== true || profile.sample_rate !== EMG.sampleRate ||
		!p || p.lowcut_hz !== 20 || p.highcut_hz !== 450 || p.notch_hz !== 50 || p.notch_quality !== 30 ||
		p.envelope_hz !== 5 || p.distance_seconds !== 2 || p.prominence !== 0.2 || p.baseline_reps !== 3 || p.rep_duration_unit !== 'samples') {
		throw new Error('Unsupported 2,000 Hz EMG preprocessing profile.');
	}
	for (const name of ['bandpass', 'notch', 'envelope'] as const) {
		const filter = profile.filters?.[name];
		if (!filter || !Array.isArray(filter.b) || !Array.isArray(filter.a) || !Array.isArray(filter.zi) ||
			filter.a.length !== filter.b.length || filter.zi.length !== filter.a.length - 1 || filter.a[0] !== 1 ||
			![...filter.a, ...filter.b, ...filter.zi].every(Number.isFinite)) throw new Error('Invalid EMG filter coefficients.');
	}
	return profile;
}

export function featureMatrix(rows: EmgFeatures[], columns: readonly string[]): Float32Array {
	const data = new Float32Array(rows.length * columns.length);
	rows.forEach((row, i) => columns.forEach((column, j) => {
		if (!Object.hasOwn(row, column) || !Number.isFinite(row[column]) || !Number.isFinite(Math.fround(row[column]))) {
			throw new Error(`Repetition ${i + 1}: missing or invalid float32 feature '${column}'.`);
		}
		data[i * columns.length + j] = row[column];
	}));
	return data;
}

export function applyTrigger(rows: EmgFeatures[], probabilities: ArrayLike<number>, meta: EmgMetadata): { rows: EmgPrediction[]; triggerRep: number | null } {
	validateMetadata(meta);
	if (probabilities.length !== rows.length) throw new Error('Model output length differs from repetition count.');
	let triggerRep: number | null = null;
	const flags: number[] = [];
	const predictions = rows.map((row, i) => {
		const p = probabilities[i];
		if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error('The EMG model returned an invalid probability.');
		const pred = Number(p >= meta.best_threshold);
		flags.push(pred);
		const count = flags.slice(Math.max(0, i - meta.trigger_N + 1)).reduce((sum, flag) => sum + flag, 0);
		if (triggerRep === null && count >= meta.trigger_M) triggerRep = row.rep;
		return { ...row, proba: p, proba_used: p, pred };
	});
	return { rows: predictions, triggerRep };
}

export async function predictRows(runtime: Pick<typeof Ort, 'Tensor'>, session: Pick<InferenceSession, 'run'>, rows: EmgFeatures[], metadata: EmgMetadata) {
	if (!rows.length) return { rows: [] as EmgPrediction[], triggerRep: null };
	const data = featureMatrix(rows, metadata.feature_cols);
	const output = await session.run({ [metadata.input_name]: new runtime.Tensor('float32', data, [rows.length, metadata.feature_cols.length]) });
	const tensor = output[metadata.output_name];
	if (!tensor || tensor.dims.length !== 2 || tensor.dims[0] !== rows.length || tensor.dims[1] !== 1 ||
		!(tensor.data instanceof Float32Array)) throw new Error('Unexpected EMG model output shape or type.');
	return applyTrigger(rows, tensor.data, metadata);
}
