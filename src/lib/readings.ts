// Rows per second of capture the dashboard loads at most, so a faster board shows a shorter strip rather than a
// heavier refresh. This is separate from the pulse sampling-rate limit.
const ROW_RATE_CAP = 1000;

export type Reading = {
	id: number;
	created_at: string;
	ekg: number | null;
	emg: number | null;
	puls: number | null;
};

/** Newest rows first, paging back until they cover `seconds` of capture time, run out, or reach the row cap. */
export async function loadRecentReadings(fetcher: typeof fetch, baseUrl: string, apiKey: string, seconds: number): Promise<Reading[]> {
	const limit = Math.ceil(seconds * ROW_RATE_CAP) + 1;
	const rows: Reading[] = [];
	const signal = AbortSignal.timeout(10000);
	let beforeId: number | undefined;
	let pageSize = Math.min(1000, limit);
	while (rows.length < limit) {
		const url = new URL('/rest/v1/ekgemgpuls', baseUrl);
		url.search = new URLSearchParams({ select: 'id,created_at,ekg,emg,puls', order: 'id.desc', limit: String(pageSize), ...(beforeId === undefined ? {} : { id: `lt.${beforeId}` }) }).toString();
		const response = await fetcher(url, { headers: { apikey: apiKey }, signal });
		if (!response.ok) throw new Error(`Supabase returned HTTP ${response.status}. Check the API key, table access, and SELECT policy.`);
		const page: Reading[] = await response.json();
		if (!Array.isArray(page) || page.length > pageSize) throw new Error('The database returned an invalid page of readings. Refresh to retry.');
		if (!page.length) break;
		let previousId = beforeId;
		for (const row of page) {
			if (!row || !Number.isSafeInteger(row.id) || (previousId !== undefined && row.id >= previousId)) throw new Error('The database returned readings out of order. Refresh to retry.');
			previousId = row.id;
		}
		rows.push(...page);
		beforeId = page.at(-1)!.id;
		// Continue even when a project caps responses below 1,000 rows; stop at timestamps we can't measure.
		const covered = Date.parse(rows[0].created_at) - Date.parse(rows.at(-1)!.created_at);
		if (!Number.isFinite(covered) || covered >= seconds * 1000) break;
		// Size the next page from the spacing so far, so the last page doesn't overshoot by up to 1,000 rows.
		const spacing = covered / (rows.length - 1);
		pageSize = Math.min(1000, limit - rows.length, spacing > 0 ? Math.ceil((seconds * 1000 - covered) / spacing) : 1000);
	}
	return rows;
}
