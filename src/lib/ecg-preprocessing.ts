import { ECG_SAMPLES, ECG_BASELINE_SAMPLES, ECG_MODEL_RATE, ECG_MODEL_SAMPLES, ECG_SAMPLE_RATE, type InputMode } from './ecg.ts';

import { notch, bandpass, decimation } from './ecg-filter-coefficients.ts';

function filter(signal: Float64Array, coefficients: typeof notch): Float64Array {
	const { a, b, zi } = coefficients;
	const state = zi.map((value) => value * signal[0]);
	const result = new Float64Array(signal.length);
	for (let i = 0; i < signal.length; i++) {
		const input = signal[i];
		const output = b[0] * input + state[0];
		for (let j = 0; j < state.length - 1; j++) state[j] = state[j + 1] + b[j + 1] * input - a[j + 1] * output;
		const last = state.length - 1;
		state[last] = b[last + 1] * input - a[last + 1] * output;
		result[i] = output;
	}
	return result;
}

/** SciPy filtfilt default: odd extension, padlen=3*max(len(a),len(b)), forward/backward. */
function filtfilt(signal: Float64Array, coefficients: typeof notch): Float64Array {
	const edge = 3 * coefficients.a.length;
	const extended = new Float64Array(signal.length + edge * 2);
	extended.set(signal, edge);
	for (let i = 0; i < edge; i++) {
		extended[i] = 2 * signal[0] - signal[edge - i];
		extended[edge + signal.length + i] = 2 * signal[signal.length - 1] - signal[signal.length - 2 - i];
	}
	const forward = filter(extended, coefficients).reverse();
	return filter(forward, coefficients).reverse().slice(edge, edge + signal.length);
}

/** Anti-aliases raw 2 kHz ECG, then filters and standardizes at the 500 Hz model rate. */
export function prepareWaveform(signal: Float64Array, mode: InputMode): Float32Array {
	if (signal.length <= 3 * bandpass.a.length || signal.some((value) => !Number.isFinite(value))) throw new Error('Invalid ECG waveform.');
	if (mode === 'preprocessed') return Float32Array.from(signal);
	const resampled = downsample(signal);
	if (resampled.length <= 3 * bandpass.a.length) throw new Error('Invalid ECG waveform.');
	const filtered = filtfilt(filtfilt(resampled, notch), bandpass);
	// Preserve the approximately 0.4-second baseline window at 500 Hz, with zero padding.
	const halfWindow = (ECG_BASELINE_SAMPLES - 1) / 2;
	const centered = new Float64Array(filtered.length);
	for (let i = 0; i < filtered.length; i++) {
		const window = Array.from({ length: ECG_BASELINE_SAMPLES }, (_, j) => filtered[i + j - halfWindow] ?? 0);
		window.sort((a, b) => a - b);
		centered[i] = filtered[i] - window[halfWindow];
	}
	return standardize(centered);
}

function standardize(values: Float64Array): Float32Array {
	const mean = values.reduce((total, value) => total + value, 0) / values.length;
	const variance = values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
	const std = Math.sqrt(variance);
	if (!Number.isFinite(std) || std < 1e-12) throw new Error('No usable ECG variation remains after filtering.');
	const prepared = Float32Array.from(values, (value) => (value - mean) / (std + 1e-8));
	if (prepared.some((value) => !Number.isFinite(value))) throw new Error('ECG preprocessing produced invalid samples.');
	return prepared;
}

/** SciPy resample_poly(up=1, down=4), symmetric 81-tap Kaiser FIR, zero extension.
 * Compensates the 40-sample group delay: output m is centered at capture sample 4m.
 */
export function downsample(signal: ArrayLike<number>): Float64Array {
    const factor = ECG_SAMPLE_RATE / ECG_MODEL_RATE;
    const half = (decimation.length - 1) / 2;
    const output = new Float64Array(Math.ceil(signal.length / factor));
    for (let m = 0; m < output.length; m++) {
        let sum = 0;
        for (let k = 0; k < decimation.length; k++) {
            const index = m * factor + half - k;
            if (index >= 0 && index < signal.length) sum += decimation[k] * signal[index];
        }
        output[m] = sum;
    }
    return output;
}

/** Ten seconds of raw 2 kHz acquisition becomes ten seconds of model-rate ECG. */
export function modelInput(signal: Float64Array): Float32Array {
	if (signal.length !== ECG_SAMPLES) throw new Error('Invalid ECG waveform.');
	const input = prepareWaveform(signal, 'raw');
	if (input.length !== ECG_MODEL_SAMPLES) throw new Error('Unexpected ECG model input size.');
	return input;
}
