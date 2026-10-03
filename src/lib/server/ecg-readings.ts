import { ECG_SAMPLES } from '../ecg.ts';
import { databaseEcgWindow, type EcgReading, type EcgWindow } from '../ecg-database.ts';

export async function loadDatabaseEcg(fetcher: typeof fetch, baseUrl: string, apiKey: string, throughId: number | undefined): Promise<EcgWindow> {
	if (throughId === undefined) return databaseEcgWindow([]);
	const rows: EcgReading[] = [];
	let beforeId: number | undefined;
	const signal = AbortSignal.timeout(10000);
	try {
		while (rows.length < ECG_SAMPLES) {
			const url = new URL('/rest/v1/ekgemgpuls', baseUrl);
			url.search = new URLSearchParams({
				select: 'id,created_at,ekg', order: 'id.desc',
				ekg: 'not.is.null',
				limit: String(Math.min(1000, ECG_SAMPLES - rows.length)),
				id: beforeId === undefined ? `lte.${throughId}` : `lt.${beforeId}`
			}).toString();
			const response = await fetcher(url, { headers: { apikey: apiKey }, signal });
			if (!response.ok) throw new Error(`Could not load ECG samples (HTTP ${response.status}). Refresh to retry.`);
			const page: EcgReading[] = await response.json();
			if (!page.length) break;
			let previousId = beforeId ?? throughId + 1;
			for (const row of page) {
				if (!Number.isSafeInteger(row.id) || row.id >= previousId) throw new Error('The database returned an invalid ECG sample order. Refresh to retry.');
				previousId = row.id;
			}
			rows.push(...page);
			beforeId = page.at(-1)!.id;
			// Continue even when a project caps responses below 1,000 rows.
		}
		return databaseEcgWindow(rows);
	} catch (error) {
		return { ...databaseEcgWindow([]), error: error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Could not load ECG samples. Refresh to retry.' };
	}
}
