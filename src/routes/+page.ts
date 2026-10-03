import * as env from '$app/env/public';
import type { PageLoad } from './$types';
import { loadRecentReadings, type Reading } from '#lib/readings.ts';
import { databaseEcgWindow } from '#lib/ecg-database.ts';
import { loadDatabaseEcg } from '#lib/ecg-readings.ts';
import { estimatePulseWithTiming, pulseConfiguration, timestampPulseWindow } from '#lib/pulse.ts';
import { loadDatabasePulse } from '#lib/pulse-readings.ts';

// The strip shows 10 seconds. Its heart-rate line analyses 2.5 s more, so the first rate (which needs two
// beats away from the analysis edge) lands before the strip's left edge.
const STRIP_SECONDS = 10;
const RATE_LEAD_SECONDS = 2.5;

export const load: PageLoad = async ({ fetch, depends, url: pageUrl }) => {
	depends('app:readings');
	const pulseConfig = pulseConfiguration(pageUrl.searchParams.get('pulseSampleRate'));
	const noPulse = estimatePulseWithTiming([], pulseConfig);
	const base = { readings: [] as Reading[], ecg: databaseEcgWindow([]), pulse: noPulse, heartRate: noPulse, loadedAt: '', error: '' };
	if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
		return { ...base, error: 'Add your Supabase URL and publishable key to .env, then restart the app.' };
	}
	try {
		const rows = await loadRecentReadings(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, STRIP_SECONDS + RATE_LEAD_SECONDS);
		const newest = Date.parse(rows[0]?.created_at);
		const readings = Number.isFinite(newest) ? rows.filter((row) => newest - Date.parse(row.created_at) <= STRIP_SECONDS * 1000) : rows;
		// Valid timestamps let the loaded rows time the pulse; otherwise the sampling-rate fallback loads its own window.
		const timed = !timestampPulseWindow(rows).invalid;
		const [ecg, pulse] = await Promise.all([
			loadDatabaseEcg(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, rows[0]?.id),
			timed ? estimatePulseWithTiming(rows, pulseConfig) : loadDatabasePulse(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, rows[0]?.id, pulseConfig)
		]);
		const heartRate = timed ? estimatePulseWithTiming(rows, pulseConfig, STRIP_SECONDS + RATE_LEAD_SECONDS) : pulse;
		return { readings, ecg, pulse, heartRate, loadedAt: new Date().toISOString(), error: '' };
	} catch (error) {
		// Our own errors explain the problem; network failures and timeouts get the generic message.
		return { ...base, error: error instanceof Error && error.name === 'Error' ? error.message : 'Could not reach Supabase. Check your connection and project URL, then try again.' };
	}
};
