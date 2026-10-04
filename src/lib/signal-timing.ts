import { captureMilliseconds } from './capture-time.ts';

type Capture = { id: number; created_at: string };

/** Never stitch pauses, old 125 Hz samples or invalid capture times into a 2 kHz window. */
export function continuousCapture(older: Capture, newer: Capture, rate: number): boolean {
	const step = captureMilliseconds(newer.created_at) - captureMilliseconds(older.created_at);
	return newer.id === older.id + 1 && Number.isFinite(step) && step > 0 && step <= 5 * 1000 / rate;
}

/** Allow scheduling jitter, but require the window's average rate to be within 20% of configuration. */
export function expectedCaptureRate(rows: Capture[], rate: number): boolean {
	if (rows.length < 2) return false;
	const elapsed = captureMilliseconds(rows.at(-1)!.created_at) - captureMilliseconds(rows[0].created_at);
	const observed = (rows.length - 1) * 1000 / elapsed;
	return Number.isFinite(observed) && Math.abs(observed / rate - 1) <= 0.2;
}
