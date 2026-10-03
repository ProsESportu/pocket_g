import * as env from '$app/env/public';
import type { PageLoad } from './$types';
import type { Reading } from '#lib/readings.js';
import { databaseEcgWindow } from '#lib/ecg-database.ts';
import { loadDatabaseEcg } from '#lib/ecg-readings.ts';
import { estimatePulseWithTiming, pulseConfiguration } from '#lib/pulse.ts';
import { loadDatabasePulse } from '#lib/pulse-readings.ts';

export const load: PageLoad = async ({ fetch, depends, url: pageUrl }) => {
	depends('app:readings');
	const pulseConfig = pulseConfiguration(pageUrl.searchParams.get('pulseSampleRate'));
	const base = { readings: [] as Reading[], ecg: databaseEcgWindow([]), pulse: estimatePulseWithTiming([], pulseConfig), loadedAt: '', error: '' };
	if (!env.PUBLIC_SUPABASE_URL || !env.PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
		return { ...base, error: 'Add your Supabase URL and publishable key to .env, then restart the app.' };
	}
	try {
		const url = new URL('/rest/v1/ekgemgpuls', env.PUBLIC_SUPABASE_URL);
		url.search = new URLSearchParams({ select: 'id,created_at,ekg,emg,puls', order: 'id.desc', limit: '100' }).toString();
		const response = await fetch(url, {
			headers: { apikey: env.PUBLIC_SUPABASE_PUBLISHABLE_KEY },
			signal: AbortSignal.timeout(10000)
		});
		if (!response.ok) return { ...base, error: `Supabase returned HTTP ${response.status}. Check the API key, table access, and SELECT policy.` };
		const readings: Reading[] = await response.json();
		const [ecg, pulse] = await Promise.all([
			loadDatabaseEcg(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, readings[0]?.id),
			loadDatabasePulse(fetch, env.PUBLIC_SUPABASE_URL, env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, readings[0]?.id, pulseConfig)
		]);
		return { readings, ecg, pulse, loadedAt: new Date().toISOString(), error: '' };
	} catch {
		return { ...base, error: 'Could not reach Supabase. Check your connection and project URL, then try again.' };
	}
};
