import { DEGREES, type ImuReading } from './gyro-energy.ts';

export type GyroSnapshot = { readings: ImuReading[]; throughId: number };

// Non-numeric values pass through unchanged so the calculators still reject them.
const radians = (value: unknown) => typeof value === 'number' ? value * DEGREES : value;

async function readPage(fetcher: typeof fetch, baseUrl: string, apiKey: string, params: Record<string, string>, signal: AbortSignal): Promise<unknown[]> {
	signal.throwIfAborted();
	const url = new URL('/rest/v1/readings', baseUrl);
	url.search = new URLSearchParams(params).toString();
	const response = await fetcher(url, { headers: { apikey: apiKey }, signal, cache: 'no-store' });
	if (!response.ok) throw new Error(`Could not load gyro readings (HTTP ${response.status}). Check table access and the SELECT policy.`);
	const page: unknown = await response.json();
	if (!Array.isArray(page) || page.length > Number(params.limit)) throw new Error('The database returned an invalid gyro page.');
	return page;
}

/** Zero is the boundary for an empty table; database identities start above zero. */
export async function latestGyroId(fetcher: typeof fetch, baseUrl: string, apiKey: string, signal?: AbortSignal): Promise<number> {
	const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
	const page = await readPage(fetcher, baseUrl, apiKey, { select: 'id', order: 'id.desc', limit: '1' }, requestSignal);
	if (!page.length) return 0;
	const id = (page[0] as { id?: unknown } | null)?.id;
	if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('The database returned an invalid gyro record ID.');
	return id;
}

/** Ascending keyset pagination with a fixed upper bound keeps inserts from shifting pages. */
export async function loadGyroSnapshot(fetcher: typeof fetch, baseUrl: string, apiKey: string, afterId = 0, signal?: AbortSignal): Promise<GyroSnapshot> {
	if (!Number.isSafeInteger(afterId) || afterId < 0) throw new Error('Invalid gyro session boundary.');
	const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
	const throughId = await latestGyroId(fetcher, baseUrl, apiKey, requestSignal);
	if (throughId < afterId) throw new Error('The gyro recording was cleared or replaced. Reset the energy session to start from the current recording.');
	const readings: ImuReading[] = [];
	let cursor = afterId;
	while (cursor < throughId) {
		const page = await readPage(fetcher, baseUrl, apiKey, {
			select: 'id,created_at,acc_x,acc_y,acc_z,gyro_x,gyro_y,gyro_z', order: 'id.asc', limit: '1000',
			and: `(id.gt.${cursor},id.lte.${throughId})`
		}, requestSignal);
		if (!page.length) break;
		for (const item of page) {
			const row = item as ImuReading | null;
			if (!row || !Number.isSafeInteger(row.id) || row.id <= cursor || row.id > throughId) throw new Error('The database returned gyro readings out of order.');
			cursor = row.id;
			readings.push({ ...row, gyro_x: radians(row.gyro_x), gyro_y: radians(row.gyro_y), gyro_z: radians(row.gyro_z) } as ImuReading);
		}
		// Continue even when the project caps responses below 1,000 rows.
	}
	requestSignal.throwIfAborted();
	return { readings, throughId };
}
