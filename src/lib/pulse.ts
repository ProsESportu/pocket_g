import type { Reading } from './readings.ts';

// Initial engineering defaults for a positive-going pulse waveform.
export const PULSE = {
	minSampleRate: 10, maxSampleRate: 1000, windowSeconds: 10, minSeconds: 5,
	smoothingSeconds: 0.04, baselineSeconds: 1.5, prominenceFraction: 0.2,
	minPeakSeconds: 0.25, minBeats: 3, minBpm: 30, maxBpm: 240, maxIntervalMad: 0.3
} as const;
export type PulseReading = Pick<Reading, 'id' | 'puls'> & Partial<Pick<Reading, 'created_at'>>;
export type PulseResult = {
	status: 'unset' | 'unavailable' | 'ready' | 'error';
	reason: string; bpm: number | null; hz: number | null; sampleRate: number | null;
	duration: number; beatCount: number; firstRecordId: number | null; lastRecordId: number | null;
	timing: 'timestamps' | 'sample-rate'; timestampsInvalid: boolean; timingReason: string;
};

export function validPulseRate(rate: number): boolean {
	return Number.isFinite(rate) && rate >= PULSE.minSampleRate && rate <= PULSE.maxSampleRate;
}

export function pulseConfiguration(value: string | null): PulseResult {
	const sampleRate = value === null || value.trim() === '' ? null : Number(value);
	const valid = sampleRate !== null && validPulseRate(sampleRate);
	return {
		status: value === null ? 'unset' : 'unavailable',
		reason: value === null ? 'Enter the sensor sampling rate to calculate pulse frequency.' : valid ? 'Not enough continuous pulse data.' : 'Sampling rate must be a number from 10 to 1,000 Hz.',
		bpm: null, hz: null, sampleRate: valid ? sampleRate : null,
		duration: 0, beatCount: 0, firstRecordId: null, lastRecordId: null,
		timing: 'timestamps', timestampsInvalid: false, timingReason: ''
	};
}

function quantile(sorted: number[], fraction: number): number {
	const position = (sorted.length - 1) * fraction;
	const lower = Math.floor(position);
	return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
const median = (values: number[]) => quantile([...values].sort((a, b) => a - b), 0.5);
function lowerBound(values: number[], value: number): number {
	let low = 0, high = values.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (values[middle] < value) low = middle + 1; else high = middle;
	}
	return low;
}

function smooth(values: number[], times: number[], radius: number): number[] {
	const prefix = [0];
	for (const value of values) prefix.push(prefix.at(-1)! + value);
	let start = 0, end = 0;
	return values.map((_, index) => {
		while (times[start] < times[index] - radius - 1e-9) start++;
		while (end < times.length && times[end] <= times[index] + radius + 1e-9) end++;
		return (prefix[end] - prefix[start]) / (end - start);
	});
}

// Sliding sorted window avoids sorting a 1,501-sample window for every sample.
function detrend(values: number[], times: number[], radius: number): number[] {
	const window: number[] = [];
	let start = 0, end = 0;
	return values.map((value, index) => {
		while (times[start] < times[index] - radius - 1e-9) window.splice(lowerBound(window, values[start++]), 1);
		while (end < times.length && times[end] <= times[index] + radius + 1e-9) { const added = values[end++]; window.splice(lowerBound(window, added), 0, added); }
		return value - quantile(window, 0.5);
	});
}

export function pulsePeaks(values: number[], prominence: number, minDistance: number, times?: number[]): number[] {
	const candidates: { index: number; height: number }[] = [];
	for (let index = 1; index < values.length - 1; index++) {
		if (values[index] <= values[index - 1]) continue;
		let end = index;
		while (end + 1 < values.length && values[end + 1] === values[index]) end++;
		if (end === values.length - 1 || values[end + 1] >= values[index]) { index = end; continue; }
		const peak = (index + end) / 2, height = values[index];
		let left = height, right = height;
		for (let i = index - 1; i >= 0 && values[i] <= height; i--) left = Math.min(left, values[i]);
		for (let i = end + 1; i < values.length && values[i] <= height; i++) right = Math.min(right, values[i]);
		if (height - Math.max(left, right) >= prominence) candidates.push({ index: peak, height });
		index = end;
	}
	const kept: number[] = [];
	for (const peak of candidates.sort((a, b) => b.height - a.height || a.index - b.index)) {
		if (kept.every((other) => Math.abs(peakTime(peak.index, times) - peakTime(other, times)) >= minDistance - 1e-9)) kept.push(peak.index);
	}
	return kept.sort((a, b) => a - b);
}

function peakTime(index: number, times?: number[]): number {
	if (!times) return index;
	const lower = Math.floor(index);
	return times[lower] + (times[Math.ceil(index)] - times[lower]) * (index - lower);
}

export function estimatePulse(readings: PulseReading[], sampleRate: number): PulseResult {
	const result = pulseConfiguration(String(sampleRate));
	result.timing = 'sample-rate';
	result.timestampsInvalid = true;
	if (!validPulseRate(sampleRate)) return result;
	const ordered = [...readings].sort((a, b) => b.id - a.id).slice(0, Math.ceil(PULSE.windowSeconds * sampleRate) + 1);
	const segment: PulseReading[] = [];
	for (const row of ordered) {
		if (!Number.isSafeInteger(row.id) || typeof row.puls !== 'number' || !Number.isFinite(row.puls)) break;
		if (segment.length && segment.at(-1)!.id !== row.id + 1) break;
		segment.push(row);
	}
	segment.reverse();
	return analyzePulse(segment, segment.map((_, i) => i / sampleRate), result);
}

function analyzePulse(segment: PulseReading[], times: number[], result: PulseResult): PulseResult {
	result.duration = times.length ? times.at(-1)! - times[0] : 0;
	result.firstRecordId = segment[0]?.id ?? null;
	result.lastRecordId = segment.at(-1)?.id ?? null;
	if (result.duration < PULSE.minSeconds) {
		result.reason = 'Need at least 5 seconds of continuous pulse samples.';
		return result;
	}
	const raw = segment.map((row) => row.puls!);
	const scale = Math.max(...raw.map(Math.abs));
	if (!scale) { result.reason = 'The pulse signal is flat.'; return result; }
	// Scaling prevents overflow and keeps detection independent of raw ADC units.
	const normalized = raw.map((value) => value / scale);
	const values = detrend(smooth(normalized, times, PULSE.smoothingSeconds / 2), times, PULSE.baselineSeconds / 2);
	const sorted = [...values].sort((a, b) => a - b);
	const range = quantile(sorted, 0.95) - quantile(sorted, 0.05);
	if (range <= 1e-12) { result.reason = 'The pulse signal is flat or has too little variation.'; return result; }
	const peaks = pulsePeaks(values, range * PULSE.prominenceFraction, PULSE.minPeakSeconds, times);
	result.beatCount = peaks.length;
	if (peaks.length < PULSE.minBeats) { result.reason = 'Need at least 3 clear pulse peaks.'; return result; }
	// Sub-sample quadratic interpolation reduces interval quantization at low rates.
	// Flat tops retain their exact midpoint rather than fitting a parabola.
	const positions = peaks.map((peak) => {
		if (!Number.isInteger(peak) || values[peak] === values[peak - 1] || values[peak] === values[peak + 1]) return peakTime(peak, times);
		const left = times[peak - 1] - times[peak], right = times[peak + 1] - times[peak];
		const leftSlope = (values[peak - 1] - values[peak]) / left;
		const rightSlope = (values[peak + 1] - values[peak]) / right;
		const curvature = (rightSlope - leftSlope) / (right - left);
		const slope = leftSlope - curvature * left;
		const offset = -slope / (2 * curvature);
		return times[peak] + Math.max(left / 2, Math.min(right / 2, offset));
	});
	const intervals = positions.slice(1).map((peak, i) => peak - positions[i]);
	const interval = median(intervals), bpm = 60 / interval;
	if (bpm < PULSE.minBpm || bpm > PULSE.maxBpm) { result.reason = 'Estimated frequency is outside the supported 30–240 BPM range.'; return result; }
	if (median(intervals.map((value) => Math.abs(value - interval))) > interval * PULSE.maxIntervalMad) {
		result.reason = 'Pulse intervals are too inconsistent for a stable estimate.';
		return result;
	}
	return { ...result, status: 'ready', reason: '', bpm, hz: 1 / interval };
}

function captureTime(value: string | undefined): number {
	if (typeof value !== 'string') return NaN;
	const milliseconds = Date.parse(value);
	// Postgres timestamps can carry microseconds, which Date.parse truncates.
	const fraction = value.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/)?.[1];
	return milliseconds + (fraction ? (Number(`0.${fraction}`) * 1000) % 1 : 0);
}

export function timestampPulseWindow(readings: PulseReading[]) {
	const ordered = [...readings].sort((a, b) => b.id - a.id);
	const segment: PulseReading[] = [], times: number[] = [];
	let invalid = '', complete = false;
	for (const row of ordered) {
		if (!Number.isSafeInteger(row.id) || typeof row.puls !== 'number' || !Number.isFinite(row.puls) || (segment.length && segment.at(-1)!.id !== row.id + 1)) { complete = true; break; }
		const time = captureTime(row.created_at);
		if (!Number.isFinite(time)) { invalid = 'Pulse capture timestamps are missing or invalid.'; break; }
		if (times.length && time >= times.at(-1)!) { invalid = 'Pulse capture timestamps repeat or run backwards.'; break; }
		if (times.length && times[0] - time > PULSE.windowSeconds * 1000) { complete = true; break; }
		segment.push(row); times.push(time);
		if (times[0] - time >= PULSE.windowSeconds * 1000) { complete = true; break; }
	}
	segment.reverse(); times.reverse();
	if (times.length > 1) {
		const intervals = times.slice(1).map((time, i) => (time - times[i]) / 1000);
		const gapLimit = Math.max(1, median(intervals) * 5);
		const lastGap = intervals.findLastIndex((interval) => interval > gapLimit);
		if (lastGap >= 0) { segment.splice(0, lastGap + 1); times.splice(0, lastGap + 1); }
	}
	const origin = times[0] ?? 0;
	return { segment, times: times.map((time) => (time - origin) / 1000), invalid, complete: complete || !!invalid };
}

export function estimatePulseWithTiming(readings: PulseReading[], configuration: PulseResult): PulseResult {
	const window = timestampPulseWindow(readings);
	if (window.invalid) {
		const fallback = configuration.sampleRate === null ? { ...configuration } : estimatePulse(readings, configuration.sampleRate);
		return { ...fallback, timing: 'sample-rate', timestampsInvalid: true, timingReason: window.invalid };
	}
	return analyzePulse(window.segment, window.times, {
		...pulseConfiguration(null), status: 'unavailable', sampleRate: null,
		reason: 'Need at least 5 seconds of continuous pulse samples.'
	});
}

export function pulseDisplay(current: PulseResult, previous: PulseResult | null, refreshError: string) {
	const failure = refreshError || (current.status === 'error' ? current.reason : '');
	return { result: failure && previous ? previous : current, stale: !!(failure && previous), failure };
}
