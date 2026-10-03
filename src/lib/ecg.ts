// The Pi records at 125 Hz; ECGFounder takes 10 seconds at 500 Hz. The newest 10 seconds of database
// samples are upsampled 4x in the browser to the model's input size.
export const ECG_SAMPLE_RATE = 125;
export const ECG_MODEL_RATE = 500;
export const ECG_MODEL_SAMPLES = 5000;
export const ECG_SAMPLES = ECG_MODEL_SAMPLES * ECG_SAMPLE_RATE / ECG_MODEL_RATE;
export const ECG_BASELINE_SAMPLES = 51;
export const ECG_LABELS = 150;
// Only these labels leave the worker; abnormal findings are never shown.
export const NORMAL_ECG_LABELS = new Set(['NORMAL SINUS RHYTHM', 'NORMAL ECG', 'SINUS RHYTHM', 'otherwise normal ecg']);
export type InputMode = 'raw' | 'preprocessed';
export type EcgScore = { index: number; label: string; logit: number; score: number };
export type InferenceRequest = { requestId: number; samples: number[]; modelUrl: string; labelsUrl: string };
export type InferenceMessage =
	| { requestId: number; type: 'status'; text: string; progress?: number }
	| { requestId: number; type: 'result'; scores: EcgScore[]; elapsedMs: number }
	| { requestId: number; type: 'error'; text: string };

export type EcgResult = {
	status: 'ready' | 'unavailable'; reason: string; scores: EcgScore[];
	window: Omit<import('./ecg-database.ts').EcgWindow, 'samples' | 'error'>;
	analyzedAt: string; elapsedMs: number;
};

export function serializeEcgResult(result: EcgResult): string {
	return JSON.stringify({
		model: 'ECGFounder single-lead', source: 'public.ekgemgpuls.ekg',
		firstRecordId: result.window.firstRecordId, lastRecordId: result.window.lastRecordId,
		startedAt: result.window.startedAt, endedAt: result.window.endedAt,
		assumedSampleRate: ECG_SAMPLE_RATE, assumedLead: 'I', samples: ECG_SAMPLES,
		preprocessing: 'raw', resampling: `Lanczos (a = 4) from ${ECG_SAMPLE_RATE} Hz to ${ECG_MODEL_RATE} Hz`, modelSamples: ECG_MODEL_SAMPLES,
		inferenceMs: result.elapsedMs, analyzedAt: result.analyzedAt,
		status: result.status, reason: result.reason, scores: result.scores,
		validation: `Unvalidated model outputs requiring clinical context; ${ECG_SAMPLE_RATE} Hz recordings are upsampled to the model’s ${ECG_MODEL_RATE} Hz input, which adds no detail above ${ECG_SAMPLE_RATE / 2} Hz.`
	}, null, 2);
}

export function validateWaveform(values: unknown): Float64Array {
	if (!Array.isArray(values) || values.length !== ECG_SAMPLES) {
		throw new Error(`Not enough ECG data. Analysis requires exactly ${ECG_SAMPLES.toLocaleString('en-GB')} samples (10 seconds).`);
	}
	if (values.some((v) => typeof v !== 'number' || !Number.isFinite(v) || !Number.isFinite(Math.fround(v)))) {
		throw new Error('Every ECG sample must be a finite float32-compatible number.');
	}
	const waveform = Float64Array.from(values as number[]);
	if (waveform.every((v) => v === waveform[0])) throw new Error('The database ECG waveform is flat. Analysis needs a varying signal.');
	return waveform;
}

export function parseLabels(text: string): string[] {
	const labels = text.trim().split(/\r?\n/);
	if (labels.length !== ECG_LABELS || labels.some((label) => !label.trim())) {
		throw new Error('The ECGFounder label file must contain 150 nonempty labels in model output order.');
	}
	return labels;
}

export function scoreLogits(logits: ArrayLike<number>, labels: string[]): EcgScore[] {
	if (logits.length !== ECG_LABELS || labels.length !== ECG_LABELS) throw new Error('Unexpected ECGFounder output size.');
	return labels.map((label, index) => {
		const logit = logits[index];
		if (!Number.isFinite(logit)) throw new Error('The model returned a nonfinite output.');
		const exponential = Math.exp(-Math.abs(logit));
		return { index, label, logit, score: logit >= 0 ? 1 / (1 + exponential) : exponential / (1 + exponential) };
	});
}
