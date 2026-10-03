// Raw BioAmp/MCP3008 acquisition is 2,000 Hz. ECGFounder takes ten seconds at 500 Hz.
// Anti-aliased downsampling converts 20,000 capture samples into 5,000 model samples.
export const ECG_SAMPLE_RATE = 2000;
export const ECG_MODEL_RATE = 500;
export const ECG_MODEL_SAMPLES = 5000;
export const ECG_SAMPLES = ECG_MODEL_SAMPLES * ECG_SAMPLE_RATE / ECG_MODEL_RATE;
export const ECG_BASELINE_SAMPLES = 201;
export const ECG_LABELS = 150;
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
		preprocessing: 'raw', resampling: `81-tap Kaiser FIR (beta = 5), zero-phase downsampling from ${ECG_SAMPLE_RATE} Hz to ${ECG_MODEL_RATE} Hz`, modelSamples: ECG_MODEL_SAMPLES,
		inferenceMs: result.elapsedMs, analyzedAt: result.analyzedAt,
		status: result.status, reason: result.reason, scores: result.scores,
		validation: `Unvalidated model outputs requiring clinical context; raw ${ECG_SAMPLE_RATE} Hz recordings are anti-aliased and downsampled to ${ECG_MODEL_RATE} Hz. Sensor-specific accuracy and electrode placement are unverified.`
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
