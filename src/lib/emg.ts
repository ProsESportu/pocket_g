import type { Reading } from './readings.ts';

export const EMG = { sampleRate: 125, maxSamples: 7500, minSamples: 1250, minReps: 3, profile: 'experimental-125hz' } as const;
export const EMG_FEATURES = [
	'rep', 'start', 'end', 'peak_idx', 'peak_time', 'rms', 'mdf', 'env_peak', 'rep_duration',
	'rms_rel_base', 'rms_delta_base', 'mdf_rel_base', 'mdf_delta_base', 'env_peak_rel_base',
	'env_peak_delta_base', 'rep_duration_rel_base', 'rep_duration_delta_base', 'rms_diff1',
	'rms_roll3_mean', 'mdf_diff1', 'mdf_roll3_mean', 'env_peak_diff1', 'env_peak_roll3_mean', 'peak_time_diff1'
] as const;
export type EmgReading = Pick<Reading, 'id' | 'created_at' | 'emg'>;
export type EmgFilter = { b: number[]; a: number[]; zi: number[] };
export type EmgFilters = { bandpass: EmgFilter; notch: EmgFilter; envelope: EmgFilter };
export type EmgPreprocessing = {
	lowcut_hz: number; highcut_hz: number; notch_hz: number; notch_quality: number;
	envelope_hz: number; distance_seconds: number; prominence: number; baseline_reps: number;
	rep_duration_unit: string;
};
export type EmgProfile = {
	id: string; experimental: boolean; sample_rate: number;
	preprocessing: EmgPreprocessing; filters: EmgFilters;
};
export type EmgMetadata = {
	schema_version: number; source: string; source_commit: string; model_sha256: string;
	input_name: string; output_name: string; feature_cols: string[];
	best_threshold: number; trigger_M: number; trigger_N: number; smooth_alpha: number | null;
	preprocessing: EmgPreprocessing; filters: Record<string, EmgFilters>;
};
export type EmgFeatures = Record<string, number> & {
	rep: number; start: number; end: number; peak_idx: number; peak_time: number;
	rms: number; mdf: number; env_peak: number; rep_duration: number;
};
export type EmgPrediction = EmgFeatures & { proba: number; proba_used: number; pred: number };
export type EmgWindowInfo = {
	sampleCount: number; duration: number; firstRecordId: number | null; lastRecordId: number | null;
	startedAt: string; endedAt: string;
};
export type EmgWindow = EmgWindowInfo & { samples: number[]; reason: string };
export type EmgResult = {
	status: 'ready' | 'unavailable'; reason: string; rows: EmgPrediction[]; triggerRep: number | null;
	window: EmgWindowInfo; sampleRate: number; profile: string; experimental: true;
	threshold: number; triggerM: number; triggerN: number; modelSha256: string;
	analyzedAt: string; elapsedMs: number;
};
export type EmgInferenceRequest = {
	requestId: number; samples: number[]; modelUrl: string; metadataUrl: string; profileUrl: string;
};
export type EmgInferenceMessage =
	| { requestId: number; type: 'status'; text: string }
	| { requestId: number; type: 'result'; rows: EmgPrediction[]; triggerRep: number | null; elapsedMs: number; modelSha256: string }
	| { requestId: number; type: 'unavailable'; reason: string; elapsedMs: number }
	| { requestId: number; type: 'error'; text: string };

export function emgResult(window: EmgWindowInfo, update: Partial<EmgResult> = {}): EmgResult {
	return {
		status: 'unavailable', reason: '', rows: [], triggerRep: null, window: { ...window },
		sampleRate: EMG.sampleRate, profile: EMG.profile, experimental: true,
		threshold: 0.58, triggerM: 2, triggerN: 3, modelSha256: '',
		analyzedAt: new Date().toISOString(), elapsedMs: 0, ...update
	};
}

export function serializeEmgResult(result: EmgResult): string {
	return JSON.stringify({
		model: 'EMG fatigue standardized logistic regression', source: 'public.ekgemgpuls.emg',
		validation: 'Experimental preprocessing at 125 Hz; fatigue predictions are unvalidated at this rate.',
		timing: 'Consecutive database rows are assumed uniformly spaced at 125 Hz. Window-relative repetition numbering and baseline.',
		...result
	}, null, 2);
}
