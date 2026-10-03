import { EMG, type EmgReading, type EmgWindow } from './emg.ts';

/** Keep only the continuous segment ending at the snapshot's newest row. */
export function databaseEmgWindow(readings: EmgReading[]): EmgWindow {
	const segment: EmgReading[] = [];
	for (const row of [...readings].sort((a, b) => b.id - a.id).slice(0, EMG.maxSamples)) {
		if (!row || !Number.isSafeInteger(row.id) || typeof row.emg !== 'number' || !Number.isFinite(row.emg)) break;
		const newer = segment.at(-1);
		if (newer && (newer.id !== row.id + 1 || Date.parse(newer.created_at) - Date.parse(row.created_at) > 1000)) break;
		segment.push(row);
	}
	segment.reverse();
	return {
		samples: segment.map((row) => row.emg!), sampleCount: segment.length, duration: segment.length / EMG.sampleRate,
		firstRecordId: segment[0]?.id ?? null, lastRecordId: segment.at(-1)?.id ?? null,
		startedAt: segment[0]?.created_at ?? '', endedAt: segment.at(-1)?.created_at ?? '',
		reason: segment.length < EMG.minSamples ? `Need at least 10 continuous seconds of EMG (${EMG.minSamples.toLocaleString('en-GB')} samples). Found ${segment.length.toLocaleString('en-GB')}.` : ''
	};
}

export async function loadDatabaseEmg(
	fetcher: typeof fetch, baseUrl: string, apiKey: string, throughId: number | undefined, signal?: AbortSignal
): Promise<EmgWindow> {
	if (throughId === undefined) return databaseEmgWindow([]);
	if (!Number.isSafeInteger(throughId)) throw new Error('Invalid EMG snapshot record ID. Refresh to retry.');
	const rows: EmgReading[] = [];
	const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
	let beforeId: number | undefined;
	while (rows.length < EMG.maxSamples) {
		requestSignal.throwIfAborted();
		const pageSize = Math.min(1000, EMG.maxSamples - rows.length);
		const url = new URL('/rest/v1/ekgemgpuls', baseUrl);
		url.search = new URLSearchParams({
			select: 'id,created_at,emg', order: 'id.desc', limit: String(pageSize),
			id: beforeId === undefined ? `lte.${throughId}` : `lt.${beforeId}`
		}).toString();
		const response = await fetcher(url, { headers: { apikey: apiKey }, signal: requestSignal });
		if (!response.ok) throw new Error(`Could not load EMG samples (HTTP ${response.status}). Retry analysis.`);
		const page: EmgReading[] = await response.json();
		if (!Array.isArray(page) || page.length > pageSize) throw new Error('The database returned an invalid EMG sample page.');
		if (!page.length) break;
		let previousId = beforeId;
		for (const row of page) {
			if (!row || !Number.isSafeInteger(row.id) || row.id > throughId || (previousId !== undefined && row.id >= previousId)) {
				throw new Error('The database returned an invalid EMG sample order. Refresh to retry.');
			}
			previousId = row.id;
		}
		rows.push(...page);
		beforeId = page.at(-1)!.id;
		// Stop at the first discontinuity, including one crossing a page boundary.
		if (databaseEmgWindow(rows).sampleCount < rows.length) break;
	}
	return databaseEmgWindow(rows);
}
