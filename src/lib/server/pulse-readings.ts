import { estimatePulseWithTiming, timestampPulseWindow, PULSE, type PulseReading, type PulseResult } from '../pulse.ts';

export async function loadDatabasePulse(fetcher: typeof fetch, baseUrl: string, apiKey: string, throughId: number | undefined, configuration: PulseResult): Promise<PulseResult> {
	if (throughId === undefined) return estimatePulseWithTiming([], configuration);
	let limit = PULSE.maxSampleRate * PULSE.windowSeconds + 1;
	const rows: PulseReading[] = [];
	const signal = AbortSignal.timeout(10000);
	let beforeId: number | undefined;
	try {
		while (rows.length < limit) {
			const url = new URL('/rest/v1/ekgemgpuls', baseUrl);
			const pageSize = Math.min(1000, limit - rows.length);
			url.search = new URLSearchParams({ select: 'id,created_at,puls', order: 'id.desc', limit: String(pageSize), id: beforeId === undefined ? `lte.${throughId}` : `lt.${beforeId}` }).toString();
			const response = await fetcher(url, { headers: { apikey: apiKey }, signal });
			if (!response.ok) throw new Error(`Could not load pulse samples (HTTP ${response.status}). Refresh to retry.`);
			const page: PulseReading[] = await response.json();
			if (!Array.isArray(page) || page.length > pageSize) throw new Error('The database returned an invalid pulse sample page.');
			if (!page.length) break;
			let previousId = beforeId;
			for (const row of page) {
				if (!row || !Number.isSafeInteger(row.id) || row.id > throughId || (previousId !== undefined && row.id >= previousId)) throw new Error('The database returned an invalid pulse sample order. Refresh to retry.');
				previousId = row.id;
			}
			rows.push(...page);
			beforeId = page.at(-1)!.id;
			const window = timestampPulseWindow(rows);
			if (window.invalid) {
				if (configuration.sampleRate === null) break;
				limit = Math.ceil(PULSE.windowSeconds * configuration.sampleRate) + 1;
			} else if (window.complete) break;
		}
		return estimatePulseWithTiming(rows, configuration);
	} catch (error) {
		return { ...configuration, status: 'error', reason: error instanceof Error && error.name !== 'TimeoutError' && error.name !== 'AbortError' ? error.message : 'Could not load pulse samples. Refresh to retry.' };
	}
}
