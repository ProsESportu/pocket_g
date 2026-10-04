import { captureMilliseconds } from './capture-time.ts';
import type { CoachNote } from './coach.ts';
import { estimatePulseWithTiming, pulseConfiguration, type PulseReading } from './pulse.ts';

// Heart rate in the first 10 s after a set, and in the 10 s centered on one minute later.
export const RECOVERY = { seconds: 60, windowSeconds: 10, stepSeconds: 5, keep: 5 } as const;
export const RECOVERY_TOTAL_SECONDS = RECOVERY.seconds + RECOVERY.windowSeconds / 2;

export type RecoveryPoint = { seconds: number; bpm: number | null };
export type Recovery = {
	status: 'recording' | 'done' | 'unavailable'; label: string; startMs: number; elapsedSeconds: number;
	startBpm: number | null; endBpm: number | null; dropBpm: number | null; curve: RecoveryPoint[]; reason: string;
};

export type RecoveryCache = Record<number, { bpm: number | null; reason: string }>;

/**
 * Pulse rows from the start of recovery onwards (any order); the label names what ended, e.g. "set 2".
 * `cache` keeps windows that ended over two seconds before the newest row, so a live recovery at 1,800 Hz only
 * analyses each 10-second window once. When timestamps run backwards inside a window, the pulse is timed by
 * `sampleRate` instead.
 */
export function measureRecovery(rows: readonly PulseReading[], startMs: number, label: string, sampleRate: number | null = null, cache: RecoveryCache = {}): Recovery {
	// Parsed once: a minute of a 1,800 Hz board is about 110,000 rows, too many to re-parse per window or to spread into Math.max.
	const times = rows.map((row) => captureMilliseconds(row.created_at));
	const latest = times.reduce((newest, time) => Number.isFinite(time) && time > newest ? time : newest, -Infinity);
	const elapsedSeconds = Number.isFinite(latest) ? Math.max(0, (latest - startMs) / 1000) : 0;
	const configuration = pulseConfiguration(sampleRate === null ? null : String(sampleRate));
	const windowBpm = (from: number) => {
		if (cache[from]) return cache[from];
		const [fromMs, toMs] = [startMs + from * 1000, startMs + (from + RECOVERY.windowSeconds) * 1000];
		const result = estimatePulseWithTiming(rows.filter((_, i) => times[i] >= fromMs && times[i] <= toMs), configuration, RECOVERY.windowSeconds);
		const value = result.status === 'ready' ? { bpm: result.bpm, reason: '' } : { bpm: null, reason: result.reason };
		if (latest - toMs > 2000) cache[from] = value;
		return value;
	};
	const curve: RecoveryPoint[] = [];
	for (let from = 0; from + RECOVERY.windowSeconds <= Math.min(elapsedSeconds, RECOVERY_TOTAL_SECONDS) + 1e-9; from += RECOVERY.stepSeconds) {
		curve.push({ seconds: from + RECOVERY.windowSeconds / 2, bpm: windowBpm(from).bpm });
	}
	const start = elapsedSeconds >= RECOVERY.windowSeconds ? windowBpm(0) : null;
	const base = { label, startMs, elapsedSeconds, startBpm: start?.bpm ?? null, endBpm: null, dropBpm: null, curve };
	if (elapsedSeconds < RECOVERY_TOTAL_SECONDS) return { ...base, status: 'recording', reason: '' };
	const end = windowBpm(RECOVERY.seconds - RECOVERY.windowSeconds / 2);
	if (start?.bpm == null) return { ...base, status: 'unavailable', reason: `Pulse beats weren’t clear just after ${label}. ${start?.reason ?? ''}`.trim() };
	if (end.bpm === null) return { ...base, endBpm: null, status: 'unavailable', reason: `Pulse beats weren’t clear one minute after ${label}. ${end.reason}`.trim() };
	// Rounded first, so the drop always agrees with the two whole numbers shown beside it.
	return { ...base, status: 'done', endBpm: end.bpm, dropBpm: Math.round(start.bpm) - Math.round(end.bpm), reason: '' };
}

/** Pages pulse rows in ID order from `startMs`, or after `afterId`, until a short page or the end of the recovery window. */
export async function loadRecoveryPulse(fetcher: typeof fetch, baseUrl: string, apiKey: string, startMs: number, afterId: number | null, signal?: AbortSignal): Promise<PulseReading[]> {
	const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
	const rows: PulseReading[] = [];
	let cursor = afterId;
	for (;;) {
		const url = new URL('/rest/v1/ekgemgpuls', baseUrl);
		url.search = new URLSearchParams({
			select: 'id,created_at,puls', order: 'id.asc', limit: '1000',
			created_at: `gte.${new Date(startMs).toISOString()}`, ...(cursor === null ? {} : { id: `gt.${cursor}` })
		}).toString();
		const response = await fetcher(url, { headers: { apikey: apiKey }, signal: requestSignal });
		if (!response.ok) throw new Error(`Could not load pulse samples for recovery (HTTP ${response.status}).`);
		const page: PulseReading[] = await response.json();
		if (!Array.isArray(page) || page.length > 1000) throw new Error('The database returned an invalid pulse page.');
		for (const row of page) {
			if (!row || !Number.isSafeInteger(row.id) || (cursor !== null && row.id <= cursor)) throw new Error('The database returned pulse samples out of order.');
			cursor = row.id;
			rows.push(row);
		}
		const last = page.at(-1);
		if (page.length < 1000 || !last || captureMilliseconds(last.created_at) - startMs > RECOVERY_TOTAL_SECONDS * 1000) return rows;
	}
}

export function recoveryCoachNotes(history: readonly Recovery[]): CoachNote[] {
	const latest = history.at(-1);
	if (!latest || latest.status === 'recording') return [];
	const times = { from: new Date(latest.startMs).toISOString(), to: new Date(latest.startMs + RECOVERY_TOTAL_SECONDS * 1000).toISOString() };
	if (latest.status === 'unavailable') return [{ id: `recovery-${latest.startMs}`, kind: 'try', channel: 'puls', ...times, text: `${latest.reason} Keep the pulse sensor still against the skin while you rest.` }];
	const drop = Math.round(latest.dropBpm!);
	return [{ id: `recovery-${latest.startMs}`, kind: 'keep', channel: 'puls', ...times,
		text: drop >= 0 ? `Heart rate dropped ${drop} BPM in the first minute after ${latest.label}.` : `Heart rate rose ${-drop} BPM in the first minute after ${latest.label}.` }];
}
