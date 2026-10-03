import type { EmgFilter, EmgFeatures, EmgProfile } from './emg.ts';

// Port of emg_fd/src/utils/emg_processing_utils.py. All DSP arithmetic is float64.
// Inference is session based: midpoint windows and the first-three-rep baseline
// depend on the complete recording, just as in the original Python pipeline.
export function filtfilt(input: Float64Array, { b, a, zi }: EmgFilter) {
  const edge = 3 * Math.max(a.length, b.length);
  if (input.length <= edge) throw new Error(`Recording needs more than ${edge} samples.`);
  const x = new Float64Array(input.length + edge * 2);
  for (let i = 0; i < edge; i++) x[i] = 2 * input[0] - input[edge - i];
  x.set(input, edge);
  for (let i = 0; i < edge; i++) x[edge + input.length + i] = 2 * input[input.length - 1] - input[input.length - 2 - i];
  function filter(values: Float64Array) {
    const state = Float64Array.from(zi, z => z * values[0]);
    const y = new Float64Array(values.length);
    for (let k = 0; k < values.length; k++) {
      const v = values[k];
      y[k] = b[0] * v + state[0];
      // Keep SciPy's operation order: the low-pass poles are close to one.
      for (let j = 0; j < state.length - 1; j++) state[j] = state[j + 1] + b[j + 1] * v - a[j + 1] * y[k];
      const j = state.length - 1;
      state[j] = b[j + 1] * v - a[j + 1] * y[k];
    }
    return y;
  }
  const forward = filter(x);
  forward.reverse();
  const backward = filter(forward);
  backward.reverse();
  return backward.slice(edge, edge + input.length);
}

export function findPeaks(env: ArrayLike<number>, distance: number, relativeProminence: number) {
  if (!Number.isFinite(distance) || distance < 1) throw new Error('Peak distance must be at least one sample.');
  if (!Number.isFinite(relativeProminence) || relativeProminence < 0) throw new Error('Prominence must be nonnegative.');
  const candidates: number[] = [];
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i - 1] < env[i]) {
      let right = i;
      while (right + 1 < env.length && env[right + 1] === env[i]) right++;
      if (right < env.length - 1 && env[right + 1] < env[i]) candidates.push(Math.floor((i + right) / 2));
      i = right;
    }
  }
  // scipy.signal.find_peaks applies distance before prominence.
  const order = candidates.map((p, index) => ({ p, index })).sort((x, y) => env[y.p] - env[x.p] || y.p - x.p);
  const keep = new Uint8Array(candidates.length).fill(1);
  const minDistance = Math.ceil(distance);
  for (const { p, index } of order) {
    if (!keep[index]) continue;
    for (let j = index - 1; j >= 0 && p - candidates[j] < minDistance; j--) keep[j] = 0;
    for (let j = index + 1; j < candidates.length && candidates[j] - p < minDistance; j++) keep[j] = 0;
  }
  let max = -Infinity;
  for (let i = 0; i < env.length; i++) max = Math.max(max, env[i]);
  return candidates.filter((p, index) => {
    if (!keep[index]) return false;
    let leftMin = env[p], rightMin = env[p];
    for (let i = p; i >= 0 && env[i] <= env[p]; i--) leftMin = Math.min(leftMin, env[i]);
    for (let i = p; i < env.length && env[i] <= env[p]; i++) rightMin = Math.min(rightMin, env[i]);
    return env[p] - Math.max(leftMin, rightMin) >= relativeProminence * max;
  });
}

function spectrum(values: Float64Array) {
  const n = values.length;
  const re = Float64Array.from(values), im = new Float64Array(n);
  if ((n & (n - 1)) !== 0) {
    // Welch uses nperseg=len(segment) for short segments. Preserve that length.
    const power = new Float64Array(Math.floor(n / 2) + 1);
    for (let k = 0; k < power.length; k++) {
      let real = 0, imaginary = 0;
      for (let j = 0; j < n; j++) {
        const angle = 2 * Math.PI * k * j / n;
        real += values[j] * Math.cos(angle);
        imaginary -= values[j] * Math.sin(angle);
      }
      power[k] = real * real + imaginary * imaginary;
    }
    return power;
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let size = 2; size <= n; size *= 2) {
    const angle = -2 * Math.PI / size;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += size) {
      let ur = 1, ui = 0;
      for (let j = 0; j < size / 2; j++) {
        const u = i + j, v = u + size / 2;
        const tr = ur * re[v] - ui * im[v], ti = ur * im[v] + ui * re[v];
        re[v] = re[u] - tr; im[v] = im[u] - ti;
        re[u] += tr; im[u] += ti;
        [ur, ui] = [ur * wr - ui * wi, ur * wi + ui * wr];
      }
    }
  }
  return Float64Array.from(re.subarray(0, n / 2 + 1), (r, i) => r * r + im[i] * im[i]);
}

export function medianFrequency(segment: Float64Array, fs: number) {
  if (!segment.length) throw new Error('Empty repetition window.');
  const n = Math.min(1024, segment.length), step = n - Math.floor(n / 2);
  const psd = new Float64Array(Math.floor(n / 2) + 1);
  const window = Float64Array.from({ length: n }, (_, i) => n === 1 ? 1 : 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n));
  for (let start = 0; start + n <= segment.length; start += step) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += segment[start + i];
    mean /= n;
    const values = Float64Array.from(window, (w, i) => (segment[start + i] - mean) * w);
    const power = spectrum(values);
    for (let i = 0; i < psd.length; i++) psd[i] += power[i] * (i === 0 || (n % 2 === 0 && i === n / 2) ? 1 : 2);
  }
  let total = 0;
  for (const v of psd) total += v;
  if (total === 0) return 0;
  let sum = 0;
  for (let i = 0; i < psd.length; i++) {
    sum += psd[i];
    if (sum >= total / 2) return i * fs / n;
  }
  return 0;
}

export function addBaselineFeatures(rows: EmgFeatures[]) {
  if (!rows.length) return [];
  const baseColumns = ['rms', 'mdf', 'env_peak', 'rep_duration'];
  const base = Object.fromEntries(baseColumns.map(c => [c, rows.slice(0, 3).reduce((sum, r) => sum + r[c], 0) / Math.min(3, rows.length)]));
  return rows.map((row, i) => {
    const result = { ...row };
    for (const c of baseColumns) {
      result[`${c}_rel_base`] = row[c] / (base[c] + 1e-9);
      result[`${c}_delta_base`] = row[c] - base[c];
    }
    for (const c of ['rms', 'mdf', 'env_peak']) {
      result[`${c}_diff1`] = i ? row[c] - rows[i - 1][c] : 0;
      const window = rows.slice(Math.max(0, i - 2), i + 1);
      result[`${c}_roll3_mean`] = window.reduce((s, r) => s + r[c], 0) / window.length;
    }
    result.peak_time_diff1 = i ? row.peak_time - rows[i - 1].peak_time : 0;
    return result;
  });
}

export function processSignal(samples: Float64Array, profile: EmgProfile) {
  const fs = profile.sample_rate;
  if (!Number.isFinite(fs) || fs <= 2 * profile.preprocessing.highcut_hz) throw new Error('Invalid EMG filter sampling rate.');
  if (samples.length < 32 || samples.length > 10_000_000) throw new Error('Use a recording containing 32 to 10,000,000 samples.');
  for (const v of samples) if (!Number.isFinite(v)) throw new Error('Recording contains a non-finite sample.');
  const bp = filtfilt(samples, profile.filters.bandpass);
  const notch = filtfilt(bp, profile.filters.notch);
  const env = filtfilt(Float64Array.from(notch, Math.abs), profile.filters.envelope);
  if (![...notch, ...env].every(Number.isFinite)) throw new Error('EMG filtering produced a non-finite value.');
  const peaks = findPeaks(env, Math.trunc(profile.preprocessing.distance_seconds * fs), profile.preprocessing.prominence);
  const boundaries = [0, ...peaks.slice(1).map((p, i) => Math.floor((peaks[i] + p) / 2)), samples.length];
  const rows: EmgFeatures[] = peaks.map((p, i) => {
    const start = boundaries[i], end = boundaries[i + 1], segment = notch.subarray(start, end);
    let sum = 0;
    for (const v of segment) sum += v * v;
    return { rep: i + 1, start, end, peak_idx: p, peak_time: p / fs,
      rms: Math.sqrt(sum / segment.length), mdf: medianFrequency(segment, fs),
      env_peak: env[p], rep_duration: end - start };
  });
  return { rows: addBaselineFeatures(rows), peaks, env, filtered: notch, fs };
}
