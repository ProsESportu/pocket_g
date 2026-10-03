import { ECG_SAMPLES, ECG_BASELINE_SAMPLES, type InputMode } from './ecg.ts';

// scipy.signal.iirnotch(50, 30, 125) and butter(4, [0.67, 40], 'bandpass', fs=125).
// Steady-state initial conditions from scipy.signal.lfilter_zi. Fixed at ECG_SAMPLE_RATE (125 Hz).
const notch = {
	b: [0.95977356895352, 1.552946256070586, 0.95977356895352],
	a: [1, 1.552946256070586, 0.9195471379070399],
	zi: [0.04022643104647938, 0.04022643104647983]
};
const bandpass = {
	b: [0.1947278219707764, 0, -0.7789112878831056, 0, 1.1683669318246583, 0, -0.7789112878831056, 0, 0.1947278219707764],
	a: [1, -2.8335016506866877, 2.3831115378118417, -0.6503380115808338, 0.7916585699178833, -0.8274906841608182, 0.006403234376578401, 0.09090169822805605, 0.039259491682485645],
	zi: [-0.19472782197740784, -0.19472782195861826, 0.5841834659086844, 0.584183465912997, -0.584183465916911, -0.5841834659114237, 0.19472782197163954, 0.19472782197103675]
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
	// Preserve the approximately 0.4-second baseline window at 125 Hz, with zero padding.
	const halfWindow = (ECG_BASELINE_SAMPLES - 1) / 2;
	const centered = new Float64Array(signal.length);
	for (let i = 0; i < signal.length; i++) {
		const window = Array.from({ length: ECG_BASELINE_SAMPLES }, (_, j) => filtered[i + j - halfWindow] ?? 0);
		window.sort((a, b) => a - b);
		centered[i] = filtered[i] - window[halfWindow];
	}
	const mean = centered.reduce((total, value) => total + value, 0) / centered.length;
	const variance = centered.reduce((total, value) => total + (value - mean) ** 2, 0) / centered.length;
	const std = Math.sqrt(variance);
	if (!Number.isFinite(std) || std < 1e-12) throw new Error('No usable ECG variation remains after filtering.');
	const prepared = Float32Array.from(centered, (value) => (value - mean) / (std + 1e-8));
	if (prepared.some((value) => !Number.isFinite(value))) throw new Error('ECG preprocessing produced invalid samples.');
	return prepared;
}
