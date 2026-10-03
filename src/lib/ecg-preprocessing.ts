import { ECG_SAMPLES, type InputMode } from './ecg.ts';

// scipy.signal.iirnotch(50, 30, 500) and butter(4, [0.67, 40], 'bandpass', fs=500).
// Steady-state initial conditions from scipy.signal.lfilter_zi. These are fixed at 500 Hz.
const notch = {
	b: [0.9896361753628921, -1.6012649682336106, 0.9896361753628921],
	a: [1, -1.6012649682336106, 0.9792723507257841],
	zi: [0.010363824637107943, 0.010363824637107943]
};
const bandpass = {
	b: [0.0021067813406203902, 0, -0.008427125362481561, 0, 0.012640688043722342, 0, -0.008427125362481561, 0, 0.0021067813406203902],
	a: [1, -6.69982772563499, 19.691253828465822, -33.190544451430235, 35.11756594006398, -23.895107000645453, 10.212953481905869, -2.5068563003602984, 0.27056222781627265],
	zi: [-0.00210677894419725, -0.0021067949998194524, 0.006320377551238459, 0.006320298012649673, -0.006320305874524994, -0.006320363137312367, 0.002106786699727256, 0.0021067806922388066]
};

function filter(signal: Float64Array, coefficients: typeof notch): Float64Array {
	const { a, b, zi } = coefficients;
	const state = zi.map((value) => value * signal[0]);
	const result = new Float64Array(signal.length);
	for (let i = 0; i < signal.length; i++) {
		const input = signal[i];
		const output = b[0] * input + state[0];
		for (let j = 0; j < state.length - 1; j++) state[j] = b[j + 1] * input + state[j + 1] - a[j + 1] * output;
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

export function prepareWaveform(signal: Float64Array, mode: InputMode): Float32Array {
	if (signal.length !== ECG_SAMPLES || signal.some((value) => !Number.isFinite(value))) throw new Error('Invalid ECG waveform.');
	if (mode === 'preprocessed') return Float32Array.from(signal);
	const filtered = filtfilt(filtfilt(signal, notch), bandpass);
	// scipy.signal.medfilt with a 201-sample window and zero padding.
	const centered = new Float64Array(signal.length);
	for (let i = 0; i < signal.length; i++) {
		const window = Array.from({ length: 201 }, (_, j) => filtered[i + j - 100] ?? 0);
		window.sort((a, b) => a - b);
		centered[i] = filtered[i] - window[100];
	}
	const mean = centered.reduce((total, value) => total + value, 0) / centered.length;
	const variance = centered.reduce((total, value) => total + (value - mean) ** 2, 0) / centered.length;
	const std = Math.sqrt(variance);
	if (!Number.isFinite(std) || std < 1e-12) throw new Error('No usable ECG variation remains after filtering.');
	const prepared = Float32Array.from(centered, (value) => (value - mean) / (std + 1e-8));
	if (prepared.some((value) => !Number.isFinite(value))) throw new Error('ECG preprocessing produced invalid samples.');
	return prepared;
}
